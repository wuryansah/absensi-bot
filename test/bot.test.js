'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  chatNameFor,
  filterEmployeesByDept,
  formatNotificationLine,
  handleUpdate,
  isAllowed,
  parseCekInput,
  parseCommand,
  parseDateArgs,
  parseMonthInput,
  resolveAccess,
} = require('../src/bot');
const config = require('../src/config');
const { todayInTz } = require('../src/dates');

test('parseCommand memisahkan perintah, username bot, dan argumen', () => {
  assert.deepEqual(parseCommand('/today@BotAbsensi'), {
    command: 'today',
    argsText: '',
    args: [],
  });

  assert.deepEqual(parseCommand('/cek Budi Santoso 02-11-2026'), {
    command: 'cek',
    argsText: 'Budi Santoso 02-11-2026',
    args: ['Budi', 'Santoso', '02-11-2026'],
  });

  assert.equal(parseCommand('halo'), null);
});

test('formatNotificationLine mengganti chat id dengan nama', () => {
  const previous = config.chatNames;
  config.chatNames = new Map([
    ['100000001', 'Budi'],
    ['-100000002', 'Grup'],
  ]);

  assert.equal(
    formatNotificationLine('[in] chat=100000001 from=Budi text="/today"'),
    '[in] chat=Budi from=Budi text="/today"',
  );
  assert.equal(
    formatNotificationLine('[out] chat=-100000002 sent chars=12'),
    '[out] chat=Grup sent chars=12',
  );
  assert.equal(
    formatNotificationLine('[cb] chat=999 data=cmd:id'),
    '[cb] chat=999 data=cmd:id',
  );
  assert.equal(chatNameFor('-100000002'), 'Grup');

  config.chatNames = previous;
});

test('parseDateArgs memakai hari ini atau memvalidasi tanggal', () => {
  assert.match(parseDateArgs([], 'Asia/Jakarta').date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(parseDateArgs(['02-11-2026'], 'Asia/Jakarta').date, '2026-11-02');
  assert.ok(parseDateArgs(['2026-02-30'], 'Asia/Jakarta').error);
  assert.ok(parseDateArgs(['2026-11-02', '2026-11-03'], 'Asia/Jakarta').error);
});

test('parseCekInput memisahkan nama dan tanggal di akhir', () => {
  assert.deepEqual(parseCekInput(['Budi', 'Santoso', '02-11-2026'], 'Asia/Jakarta'), {
    date: '2026-11-02',
    query: 'Budi Santoso',
  });

  assert.deepEqual(parseCekInput(['123'], 'Asia/Jakarta'), {
    date: parseCekInput(['123'], 'Asia/Jakarta').date,
    query: '123',
  });

  assert.ok(parseCekInput([], 'Asia/Jakarta').error);
  assert.ok(parseCekInput(['02-11-2026'], 'Asia/Jakarta').error);
  assert.ok(parseCekInput(['Budi', '2026-02-30'], 'Asia/Jakarta').error);
});

test('parseMonthInput membaca bulan berjalan, bulan eksplisit, dan nama karyawan', () => {
  const currentMonth = todayInTz('Asia/Jakarta').slice(0, 7);

  assert.deepEqual(parseMonthInput([], 'Asia/Jakarta'), {
    month: currentMonth,
    query: '',
  });

  assert.deepEqual(parseMonthInput(['2026-11'], 'Asia/Jakarta'), {
    month: '2026-11',
    query: '',
  });

  assert.deepEqual(parseMonthInput(['11-2026'], 'Asia/Jakarta'), {
    month: '2026-11',
    query: '',
  });

  assert.deepEqual(parseMonthInput(['Budi'], 'Asia/Jakarta'), {
    month: currentMonth,
    query: 'Budi',
  });

  assert.deepEqual(parseMonthInput(['Budi', 'Santoso', '2026-11'], 'Asia/Jakarta'), {
    month: '2026-11',
    query: 'Budi Santoso',
  });

  assert.deepEqual(parseMonthInput(['2026-11', 'Budi', 'Santoso'], 'Asia/Jakarta'), {
    month: '2026-11',
    query: 'Budi Santoso',
  });

  assert.ok(parseMonthInput(['2026-13'], 'Asia/Jakarta').error);
});

test('isAllowed selalu mengizinkan perintah publik seperti /menu dan /id', () => {
  const previous = config.allowedChats;
  config.allowedChats = ['123'];

  assert.equal(isAllowed('999', 'menu'), true);
  assert.equal(isAllowed('999', 'id'), true);
  assert.equal(isAllowed('999', 'today'), false);
  assert.equal(isAllowed('123', 'today'), true);

  config.allowedChats = previous;
});

test('resolveAccess membatasi dept head ke satu departemen', () => {
  const previousAllowed = config.allowedChats;
  const previousHeads = config.deptHeads;

  config.allowedChats = ['100'];
  config.deptHeads = new Map([['200', ['IT']]]);

  assert.deepEqual(resolveAccess('100'), { allowed: true, scope: null });
  assert.deepEqual(resolveAccess('200'), {
    allowed: true,
    scope: { depts: ['IT'] },
  });
  assert.deepEqual(resolveAccess('300'), { allowed: false, scope: null });

  // Dept head tetap dibatasi walau chat-nya juga ada di ALLOWED_CHATS.
  config.allowedChats = ['100', '200'];
  assert.deepEqual(resolveAccess('200').scope, { depts: ['IT'] });

  // Tanpa ALLOWED_CHATS, chat yang tidak terdaftar tetap ditolak saat
  // DEPT_HEADS sudah dipakai.
  config.allowedChats = [];
  assert.equal(resolveAccess('300').allowed, false);

  // Satu chat id boleh mengakses banyak departemen.
  config.deptHeads = new Map([['400', ['IT', 'HR']]]);
  assert.deepEqual(resolveAccess('400').scope, { depts: ['IT', 'HR'] });

  config.allowedChats = previousAllowed;
  config.deptHeads = previousHeads;
});

test('resolveAccess mempertahankan mode terbuka saat belum ada pengaturan', () => {
  const previousAllowed = config.allowedChats;
  const previousHeads = config.deptHeads;

  config.allowedChats = [];
  config.deptHeads = new Map();

  assert.deepEqual(resolveAccess('999'), { allowed: true, scope: null });

  config.allowedChats = previousAllowed;
  config.deptHeads = previousHeads;
});

test('filterEmployeesByDept mencocokkan DEPTID atau nama departemen', () => {
  const employees = [
    { userId: '1', deptId: '10', deptName: 'IT' },
    { userId: '2', deptId: '20', deptName: 'HR' },
  ];

  assert.deepEqual(
    filterEmployeesByDept(employees, ['IT']).map((employee) => employee.userId),
    ['1'],
  );
  assert.deepEqual(
    filterEmployeesByDept(employees, ['20']).map((employee) => employee.userId),
    ['2'],
  );

  assert.deepEqual(
    filterEmployeesByDept(employees, ['IT', 'HR']).map((employee) => employee.userId).sort(),
    ['1', '2'],
  );
});

function fakeTelegram() {
  const calls = { send: [], answer: [] };
  return {
    calls,
    sendMessage: async (chatId, text, options = {}) => {
      calls.send.push({ chatId, text, options });
    },
    answerCallbackQuery: async (id, text) => {
      calls.answer.push({ id, text });
    },
  };
}

test('handleUpdate /menu mengirim teks dan tombol menu', async () => {
  const tg = fakeTelegram();
  await handleUpdate(tg, {
    message: {
      chat: { id: 999, type: 'private' },
      from: { id: 1, first_name: 'Tes' },
      text: '/menu',
    },
  });

  assert.equal(tg.calls.send.length, 1);
  assert.match(tg.calls.send[0].text, /Menu Bot Absensi/);
  assert.ok(tg.calls.send[0].options.reply_markup.inline_keyboard.length > 0);
});

test('handleUpdate callback cmd:id membalas chat id dan menjawab callback', async () => {
  const tg = fakeTelegram();
  await handleUpdate(tg, {
    callback_query: {
      id: 'cb-1',
      from: { id: 1, first_name: 'Tes' },
      message: { chat: { id: 999, type: 'private' } },
      data: 'cmd:id',
    },
  });

  assert.equal(tg.calls.answer.length, 1);
  assert.equal(tg.calls.send.length, 1);
  assert.match(tg.calls.send[0].text, /Chat ID/);
  assert.match(tg.calls.send[0].text, /999/);
});

test('handleUpdate callback cmd:cek memberi contoh pemakaian', async () => {
  const tg = fakeTelegram();
  await handleUpdate(tg, {
    callback_query: {
      id: 'cb-2',
      from: { id: 1, first_name: 'Tes' },
      message: { chat: { id: config.allowedChats[0] || 999, type: 'private' } },
      data: 'cmd:cek',
    },
  });

  assert.equal(tg.calls.answer.length, 1);
  assert.equal(tg.calls.send.length, 1);
  assert.match(tg.calls.send[0].text, /\/cek NamaKaryawan/);
});
