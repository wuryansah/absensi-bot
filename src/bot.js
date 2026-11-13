'use strict';

const fs = require('node:fs');
const path = require('node:path');

const config = require('./config');
const db = require('./db');
const { createLogNotifier } = require('./notify');
const { TelegramClient } = require('./telegram');
const {
  buildDay,
  findEmployees,
  getEmployees,
  getMonthSummary,
  getWeekSummary,
  normalizeText,
} = require('./schedule');
const report = require('./report');
const {
  formatDateLong,
  formatMonthLong,
  looksLikeDate,
  looksLikeMonth,
  parseDateArg,
  parseMonthArg,
  todayInTz,
} = require('./dates');

const DATA_COMMANDS = new Set([
  'today',
  'terlambat',
  'absen',
  'off',
  'hadir',
  'masuk',
  'cek',
  'rekap',
  'minggu',
  'bulan',
]);

const PUBLIC_COMMANDS = new Set(['start', 'help', 'id', 'menu']);

const BOT_COMMANDS = [
  { command: 'menu', description: 'Tampilkan menu tombol' },
  { command: 'today', description: 'Ringkasan absensi hari ini' },
  { command: 'terlambat', description: 'Daftar karyawan terlambat' },
  { command: 'hadir', description: 'Daftar karyawan yang sudah absen' },
  { command: 'absen', description: 'Daftar karyawan yang belum absen' },
  { command: 'off', description: 'Daftar karyawan libur' },
  { command: 'cek', description: 'Cek status satu karyawan' },
  { command: 'rekap', description: 'Rekap absensi per departemen' },
  { command: 'minggu', description: 'Ringkasan 7 hari terakhir' },
  { command: 'bulan', description: 'Rekap absensi bulan berjalan' },
  { command: 'id', description: 'Tampilkan chat ID' },
  { command: 'help', description: 'Bantuan dan daftar perintah' },
];

let running = true;
let logNotifier = null;

function chatNameFor(chatId) {
  const key = String(chatId);
  const names = config.chatNames;
  if (names.has(key)) return names.get(key);
  if (key.startsWith('-') && names.has(key.slice(1))) return names.get(key.slice(1));
  if (!key.startsWith('-') && names.has(`-${key}`)) return names.get(`-${key}`);
  return key;
}

function formatNotificationLine(line) {
  return String(line).replace(/chat=(-?\d+)/g, (_, chatId) => {
    return `chat=${chatNameFor(chatId)}`;
  });
}

function notifyLog(line) {
  if (!logNotifier) return;
  logNotifier.send(formatNotificationLine(line));
}

function formatLogArg(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Menulis console.log/error/warn ke logs/bot.log agar masalah bisa
 * diperiksa walau bot dijalankan tanpa terminal.
 */
function setupFileLogging() {
  const dir = path.join(__dirname, '..', 'logs');
  let stream;
  try {
    fs.mkdirSync(dir, { recursive: true });
    stream = fs.createWriteStream(path.join(dir, 'bot.log'), { flags: 'a' });
  } catch (error) {
    console.error('[log] Gagal membuat file log:', error.message);
    return;
  }

  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      const line = args.map(formatLogArg).join(' ');
      stream.write(`[${new Date().toISOString()}] ${level.toUpperCase()} ${line}\n`);
    };
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Mencegah dua instance berjalan bersamaan. Dua instance akan saling
 * menendang di Telegram (error 409 terminated by other getUpdates request).
 */
function acquireLock() {
  const lockPath = path.join(__dirname, '..', '.bot.pid');

  try {
    const existing = Number.parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
    if (Number.isInteger(existing) && existing > 0) {
      try {
        process.kill(existing, 0);
        console.error(
          `[bot] Instance lain sudah berjalan (PID ${existing}). ` +
            'Hentikan dulu proses itu sebelum menjalankan bot lagi.',
        );
        process.exit(0);
      } catch {
        // PID lama sudah tidak hidup, lanjutkan dan timpa lock.
      }
    }
  } catch {
    // Lock belum ada.
  }

  fs.writeFileSync(lockPath, String(process.pid));
  process.on('exit', () => {
    try {
      if (Number.parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10) === process.pid) {
        fs.unlinkSync(lockPath);
      }
    } catch {
      // Abaikan.
    }
  });
}

function parseCommand(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith('/')) return null;

  const match = /^\/([^\s@]+)(?:@[^\s]+)?(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return null;

  const command = match[1].toLowerCase();
  const argsText = (match[2] || '').trim();

  return {
    command,
    argsText,
    args: argsText ? argsText.split(/\s+/) : [],
  };
}

/**
 * Menentukan hak akses satu chat atau pengirim.
 *
 * scope null berarti akses penuh. scope berisi { dept } berarti dept head
 * dan hanya boleh melihat karyawan pada departemen tersebut.
 *
 * DEPT_HEADS mencocokkan User ID pengirim lebih dulu, lalu Chat ID. User ID
 * dipakai agar dept head tetap dibatasi saat mengirim perintah dari grup.
 * DEPT_HEADS selalu diprioritaskan di atas ALLOWED_CHATS.
 */
function resolveAccess(chatId, userId) {
  const chat = String(chatId);
  const user = userId === undefined || userId === null ? '' : String(userId);

  const depts = (user && config.deptHeads.get(user)) || config.deptHeads.get(chat);
  if (depts) {
    return { allowed: true, scope: { depts } };
  }

  if (config.allowedChats.includes(chat)) {
    return { allowed: true, scope: null };
  }

  if (!config.allowedChats.length && !config.deptHeads.size) {
    return { allowed: true, scope: null };
  }

  return { allowed: false, scope: null };
}

function isAllowed(chatId, command, userId) {
  if (PUBLIC_COMMANDS.has(command)) return true;
  return resolveAccess(chatId, userId).allowed;
}

/**
 * Memeriksa apakah karyawan berada pada salah satu departemen yang diizinkan.
 * Nilai scope boleh berupa daftar DEPTID atau DEPTNAME.
 */
function employeeInDept(employee, depts) {
  const targets = depts.map(normalizeText);
  return targets.some((target) => {
    return (
      normalizeText(employee.deptId) === target ||
      normalizeText(employee.deptName) === target
    );
  });
}

function filterEmployeesByDept(employees, depts) {
  return employees.filter((employee) => employeeInDept(employee, depts));
}

async function getVisibleEmployees(scope) {
  const employees = await getEmployees();
  if (!scope) return employees;

  const visible = filterEmployeesByDept(employees, scope.depts);
  if (visible.length) scope.label = visible[0].deptName;
  return visible;
}

function withScopeNotice(text, scope) {
  if (!scope) return text;
  const label = scope.label || scope.depts.join(', ');
  return (
    `${text}\n\n` +
    `<i>🔒 Hanya data departemen ${report.escapeHtml(label)}.</i>`
  );
}

function emptyScopeReport(scope) {
  const daftar = scope.depts
    .map((dept) => `<code>${report.escapeHtml(dept)}</code>`)
    .join(', ');
  return (
    '❌ Tidak ada karyawan pada departemen ' +
    `${daftar}.\n` +
    'Periksa pengaturan <code>DEPT_HEADS</code>.'
  );
}

function parseDateArgs(args, timeZone) {
  if (!args.length) return { date: todayInTz(timeZone) };
  if (args.length > 1) {
    return { error: '❌ Argumen tanggal terlalu banyak.' };
  }

  const date = parseDateArg(args[0], timeZone);
  if (!date) {
    return { error: `❌ Tanggal tidak valid: <code>${report.escapeHtml(args[0])}</code>` };
  }

  return { date };
}

function parseCekInput(args, timeZone) {
  if (!args.length) {
    return {
      error:
        '❌ Sebutkan nama atau id karyawan.\n' +
        'Contoh: <code>/cek Budi</code> atau <code>/cek 123 2026-11-02</code>.',
    };
  }

  let date = todayInTz(timeZone);
  let queryParts = [...args];
  const last = args[args.length - 1];

  if (looksLikeDate(last)) {
    if (args.length === 1) {
      return {
        error:
          '❌ Sebutkan nama atau id karyawan sebelum tanggal.\n' +
          'Contoh: <code>/cek Budi 2026-11-02</code>.',
      };
    }

    const parsed = parseDateArg(last, timeZone);
    if (!parsed) {
      return { error: `❌ Tanggal tidak valid: <code>${report.escapeHtml(last)}</code>` };
    }

    date = parsed;
    queryParts = args.slice(0, -1);
  }

  const query = queryParts.join(' ').trim();
  if (!query) {
    return { error: '❌ Sebutkan nama atau id karyawan.' };
  }

  return { date, query };
}

/**
 * Menerima /bulan, /bulan 2026-11, /bulan Budi, atau /bulan Budi 2026-11.
 * Tanpa bulan, dipakai bulan berjalan.
 */
function parseMonthInput(args, timeZone) {
  const currentMonth = todayInTz(timeZone).slice(0, 7);
  if (!args.length) return { month: currentMonth, query: '' };

  let month = currentMonth;
  let queryParts = [...args];

  if (looksLikeMonth(args[0])) {
    const parsed = parseMonthArg(args[0], timeZone);
    if (!parsed) {
      return { error: `❌ Bulan tidak valid: <code>${report.escapeHtml(args[0])}</code>` };
    }
    month = parsed;
    queryParts = args.slice(1);
  } else if (args.length > 1 && looksLikeMonth(args[args.length - 1])) {
    const parsed = parseMonthArg(args[args.length - 1], timeZone);
    if (!parsed) {
      return {
        error: `❌ Bulan tidak valid: <code>${report.escapeHtml(args[args.length - 1])}</code>`,
      };
    }
    month = parsed;
    queryParts = args.slice(0, -1);
  }

  return { month, query: queryParts.join(' ').trim() };
}

async function safeSend(tg, chatId, text, options = {}) {
  try {
    await tg.sendMessage(chatId, text, options);
    const line = `[out] chat=${chatId} sent chars=${text.length}`;
    console.log(line);
    notifyLog(line);
  } catch (error) {
    console.error(`[send:${chatId}]`, error.message);
  }
}

async function executeCommand(tg, chatId, command, args = [], context = {}) {
  const access = resolveAccess(chatId, context.from?.id);
  if (!PUBLIC_COMMANDS.has(command) && !access.allowed) {
    await safeSend(tg, chatId, report.deniedReport(chatId));
    return;
  }

  const scope = access.allowed ? access.scope : null;

  if (command === 'menu') {
    await safeSend(tg, chatId, report.menuText(), {
      reply_markup: report.menuKeyboard(),
    });
    return;
  }

  if (command === 'start' || command === 'help') {
    await safeSend(tg, chatId, report.helpText(), {
      reply_markup: report.menuKeyboard(),
    });
    return;
  }

  if (command === 'id') {
    await safeSend(
      tg,
      chatId,
      report.idReport(chatId, context.chat || {}, context.from || null),
    );
    return;
  }

  if (!DATA_COMMANDS.has(command)) {
    await safeSend(tg, chatId, report.helpText(), {
      reply_markup: report.menuKeyboard(),
    });
    return;
  }

  await tg.sendChatAction(chatId, 'typing').catch(() => {});

  try {
    const employees = await getVisibleEmployees(scope);
    if (scope && !employees.length) {
      await safeSend(tg, chatId, emptyScopeReport(scope));
      return;
    }

    if (command === 'minggu') {
      if (args.length) {
        await safeSend(tg, chatId, '❌ Perintah /minggu tidak menerima argumen.');
        return;
      }

      const days = await getWeekSummary(todayInTz(config.tz), { employees });
      await safeSend(tg, chatId, withScopeNotice(report.weekReport(days), scope));
      return;
    }

    if (command === 'bulan') {
      const input = parseMonthInput(args, config.tz);
      if (input.error) {
        await safeSend(tg, chatId, `${input.error}\n${report.monthFormatHint()}`);
        return;
      }

      const today = todayInTz(config.tz);
      if (input.month > today.slice(0, 7)) {
        await safeSend(
          tg,
          chatId,
          `❌ Bulan ${formatMonthLong(input.month)} belum berjalan.`,
        );
        return;
      }

      const days = await getMonthSummary(input.month, { employees });
      if (!days.length) {
        await safeSend(
          tg,
          chatId,
          `❌ Belum ada data absensi pada ${formatMonthLong(input.month)}.`,
        );
        return;
      }

      if (!input.query) {
        await safeSend(
          tg,
          chatId,
          withScopeNotice(report.monthReport(input.month, days), scope),
        );
        return;
      }

      const matches = findEmployees({ employees: days[0].employees }, input.query);

      if (!matches.length) {
        await safeSend(
          tg,
          chatId,
          `❌ Karyawan dengan nama/id <code>${report.escapeHtml(input.query)}</code> ` +
            `tidak ditemukan pada ${formatMonthLong(input.month)}.`,
        );
        return;
      }

      if (matches.length > 1) {
        await safeSend(
          tg,
          chatId,
          withScopeNotice(
            report.monthSearchResultsReport(input.month, matches, input.query),
            scope,
          ),
        );
        return;
      }

      await safeSend(
        tg,
        chatId,
        withScopeNotice(
          report.employeeMonthReport(input.month, days, matches[0]),
          scope,
        ),
      );
      return;
    }

    if (command === 'cek') {
      const input = parseCekInput(args, config.tz);
      if (input.error) {
        await safeSend(tg, chatId, input.error);
        return;
      }

      const day = await buildDay(input.date, { employees });
      const matches = findEmployees(day, input.query);

      if (!matches.length) {
        await safeSend(
          tg,
          chatId,
          `❌ Karyawan dengan nama/id <code>${report.escapeHtml(input.query)}</code> ` +
            `tidak ditemukan pada ${formatDateLong(input.date)}.`,
        );
        return;
      }

      if (matches.length > 1) {
        await safeSend(
          tg,
          chatId,
          withScopeNotice(report.searchResultsReport(day, matches, input.query), scope),
        );
        return;
      }

      await safeSend(
        tg,
        chatId,
        withScopeNotice(report.employeeReport(day, matches[0]), scope),
      );
      return;
    }

    if (command === 'today' && args.length) {
      await safeSend(
        tg,
        chatId,
        '❌ Perintah /today tidak menerima tanggal.\n' +
          'Gunakan <code>/hadir [tanggal]</code> untuk tanggal lain.',
      );
      return;
    }

    const parsedDate = command === 'today'
      ? { date: todayInTz(config.tz) }
      : parseDateArgs(args, config.tz);

    if (parsedDate.error) {
      await safeSend(
        tg,
        chatId,
        `${parsedDate.error}\n${report.dateFormatHint()}`,
      );
      return;
    }

    const day = await buildDay(parsedDate.date, { employees });

    let text;
    switch (command) {
      case 'today':
        text = report.todayReport(day);
        break;
      case 'terlambat':
        text = report.lateReport(day);
        break;
      case 'absen':
        text = report.absentReport(day);
        break;
      case 'off':
        text = report.offReport(day);
        break;
      case 'hadir':
      case 'masuk':
        text = report.presentReport(day);
        break;
      case 'rekap':
        text = report.departmentReport(day);
        break;
      default:
        text = report.helpText();
    }

    await safeSend(tg, chatId, withScopeNotice(text, scope));
  } catch (error) {
    console.error(`[cmd:${command}]`, error);
    await safeSend(
      tg,
      chatId,
      '⚠️ Gagal mengambil data absensi. Coba lagi beberapa saat.',
    );
  }
}

async function handleUpdate(tg, update) {
  if (update.callback_query) {
    const query = update.callback_query;
    const chatId = query.message?.chat?.id;
    if (!chatId || typeof query.data !== 'string') return;

    const callbackLine =
      `[cb] chat=${chatId} from=${query.from?.username || query.from?.id} data=${query.data}`;
    console.log(callbackLine);
    notifyLog(callbackLine);

    if (!query.data.startsWith('cmd:')) {
      await tg.answerCallbackQuery(query.id).catch(() => {});
      return;
    }

    const command = query.data.slice('cmd:'.length);

    if (!isAllowed(chatId, command, query.from?.id)) {
      await tg.answerCallbackQuery(query.id, 'Akses ditolak').catch(() => {});
      await safeSend(tg, chatId, report.deniedReport(chatId));
      return;
    }

    await tg.answerCallbackQuery(query.id).catch(() => {});

    if (command === 'cek') {
      await safeSend(
        tg,
        chatId,
        'Ketik perintah ini:\n' +
          '<code>/cek NamaKaryawan</code> atau <code>/cek 123</code>\n\n' +
          'Bisa ditambah tanggal:\n<code>/cek NamaKaryawan 2026-11-02</code>',
      );
      return;
    }

    if (command === 'id') {
      await safeSend(
        tg,
        chatId,
        report.idReport(chatId, query.message?.chat || {}, query.from || null),
      );
      return;
    }

    try {
      await executeCommand(tg, chatId, command, [], {
        chat: query.message?.chat,
        from: query.from,
      });
    } catch (error) {
      console.error(`[cb:${command}]`, error);
      await safeSend(
        tg,
        chatId,
        '⚠️ Gagal mengambil data absensi. Coba lagi beberapa saat.',
      );
    }
    return;
  }

  const message = update.message;
  if (!message || typeof message.text !== 'string') return;

  const chatId = message.chat.id;
  const messageLine =
    `[in] chat=${chatId} type=${message.chat.type} ` +
    `from=${message.from?.username || message.from?.id || '-'} text=${JSON.stringify(message.text)}`;
  console.log(messageLine);
  notifyLog(messageLine);

  const parsed = parseCommand(message.text);

  if (!parsed) {
    if (message.chat.type === 'private') {
      await safeSend(tg, chatId, report.helpText(), {
        reply_markup: report.menuKeyboard(),
      });
    }
    return;
  }

  try {
    await executeCommand(tg, chatId, parsed.command, parsed.args, {
      chat: message.chat,
      from: message.from,
    });
  } catch (error) {
    console.error(`[cmd:${parsed.command}]`, error);
    await safeSend(
      tg,
      chatId,
      '⚠️ Gagal mengambil data absensi. Coba lagi beberapa saat.',
    );
  }
}

async function closeDatabase() {
  try {
    await db.close();
  } catch (error) {
    console.error('[db] Gagal menutup koneksi:', error.message);
  }
}

async function shutdown(signal) {
  if (!running) return;
  running = false;
  console.log(`[bot] Menerima ${signal}, menghentikan bot...`);
  await closeDatabase();
  process.exit(0);
}

async function main() {
  setupFileLogging();

  const errors = config.validate();
  if (errors.length) {
    console.error('[bot] Konfigurasi belum lengkap:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  acquireLock();

  const notifyToken = config.telegram.notifyToken;
  const notifyChat = config.telegram.notifyChat;
  if (notifyToken && notifyChat) {
    logNotifier = createLogNotifier({ token: notifyToken, chatId: notifyChat });
    console.log(`[notify] Notifikasi log aktif ke chat=${notifyChat}.`);
  } else if (notifyToken || notifyChat) {
    console.error(
      '[notify] TG_NOTIFY_TOKEN dan TG_NOTIFY_CHAT harus diisi berdua. Notifikasi dimatikan.',
    );
  }

  const tg = new TelegramClient(config.telegram.token);

  console.log('[bot] Menghubungi Telegram...');
  try {
    const me = await tg.getMe();
    console.log(`[bot] Login sebagai @${me.username || me.first_name || me.id}`);
  } catch (error) {
    console.error(`[bot] Gagal memanggil getMe: ${error.message}`);
    if (error.statusCode === 401 || error.statusCode === 404) {
      console.error('[bot] Periksa kembali TG_TOKEN di .env.');
      process.exit(1);
    }
  }

  try {
    await tg.setMyCommands(BOT_COMMANDS);
    console.log('[bot] Menu perintah Telegram diperbarui.');
  } catch (error) {
    console.error(`[bot] Gagal memasang menu perintah: ${error.message}`);
  }

  console.log(
    `[bot] TZ=${config.tz}; toleransi=${config.lateToleranceMin} menit; ` +
      `baseline=${config.baselineDays} hari; jadwal DB=${config.scheduleFromDb ? 'aktif' : 'nonaktif'}`,
  );
  console.log(
    `[bot] ALLOWED_CHATS=${
      config.allowedChats.length ? config.allowedChats.join(',') : 'kosong'
    }`,
  );
  console.log(
    `[bot] DEPT_HEADS=${
      config.deptHeads.size
        ? [...config.deptHeads.entries()].map(([chat, dept]) => `${chat}=${dept}`).join(',')
        : 'kosong'
    }`,
  );
  console.log('[bot] Mulai polling...');

  let offset = 0;
  let backoff = 1000;

  while (running) {
    try {
      const updates = await tg.getUpdates(offset, config.telegram.pollTimeoutSec);
      backoff = 1000;

      for (const update of updates) {
        if (!running) break;
        if (update.update_id >= offset) offset = update.update_id + 1;

        try {
          await handleUpdate(tg, update);
        } catch (error) {
          console.error('[update]', error);
        }
      }
    } catch (error) {
      if (!running) break;

      if (error.statusCode === 401 || error.statusCode === 404) {
        console.error('[bot] Token Telegram tidak valid atau bot tidak ditemukan. Berhenti.');
        process.exitCode = 1;
        break;
      }

      const waitMs = error.retryAfter
        ? error.retryAfter * 1000
        : Math.min(backoff, 30000);

      console.error(
        `[poll] ${error.message}. Mencoba lagi dalam ${Math.round(waitMs / 1000)} detik.`,
      );
      await sleep(waitMs);
      backoff = Math.min(backoff * 2, 30000);
    }
  }

  await closeDatabase();
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((error) => {
    console.error('[bot] Gagal shutdown:', error);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    console.error('[bot] Gagal shutdown:', error);
    process.exit(1);
  });
});

process.on('unhandledRejection', (error) => {
  console.error('[unhandledRejection]', error);
});

if (require.main === module) {
  main().catch((error) => {
    console.error('[bot] Fatal:', error);
    closeDatabase().finally(() => process.exit(1));
  });
}

module.exports = {
  parseCommand,
  parseDateArgs,
  parseCekInput,
  parseMonthInput,
  resolveAccess,
  isAllowed,
  employeeInDept,
  filterEmployeesByDept,
  chatNameFor,
  formatNotificationLine,
  handleUpdate,
};
