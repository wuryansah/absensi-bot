'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ENV_PATH = process.env.ENV_FILE || path.join(__dirname, '..', '.env');

/**
 * Parser .env sederhana agar proyek tidak membutuhkan dependensi tambahan.
 * Mendukung komentar, tanda kutip, dan awalan "export ".
 */
function parseEnv(text) {
  const values = {};

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));

    if (quoted) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"');
      }
    } else if (value.startsWith('#')) {
      // Contoh: ALLOWED_CHATS=   # kosong = semua chat
      value = '';
    } else {
      // Komentar inline hanya jika didahului spasi.
      const comment = value.search(/\s#/);
      if (comment !== -1) value = value.slice(0, comment).trim();
    }

    values[key] = value;
  }

  return values;
}

function loadEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  const values = parseEnv(text);
  for (const [key, value] of Object.entries(values)) {
    // Variabel environment yang sudah ada tetap menang.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv(ENV_PATH);

function env(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : Number.NaN;
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(value)) return false;
  return fallback;
}

/**
 * Membaca DEPT_HEADS dengan format "chatId=dept1|dept2".
 * Departemen banyak dipisah dengan "|". Chat id yang sama boleh muncul
 * berulang kali dan digabung. Contoh:
 * DEPT_HEADS=100000001=IT|HR,100000003=Finance,100000001=Marketing
 */
function parseDeptHeads(text) {
  const heads = new Map();

  for (const part of String(text || '').split(',')) {
    const entry = part.trim();
    if (!entry) continue;

    const separator = entry.indexOf('=');
    if (separator === -1) continue;

    const chatId = entry.slice(0, separator).trim();
    const department = entry.slice(separator + 1).trim();
    if (!/^-?\d+$/.test(chatId) || !department) continue;

    const depts = department.split('|').map((value) => value.trim()).filter(Boolean);
    if (!depts.length) continue;

    const existing = heads.get(chatId) || [];
    heads.set(chatId, [...existing, ...depts]);
  }

  return heads;
}

/**
 * Membaca nama tampilan chat dengan format "chatId=nama".
 * Contoh: TG_CHAT_NAMES=100000001=Budi,-100000002=Grup
 */
function parseChatNames(text) {
  const names = new Map();

  for (const part of String(text || '').split(',')) {
    const entry = part.trim();
    if (!entry) continue;

    const separator = entry.indexOf('=');
    if (separator === -1) continue;

    const chatId = entry.slice(0, separator).trim();
    const name = entry.slice(separator + 1).trim();
    if (!/^-?\d+$/.test(chatId) || !name) continue;

    names.set(chatId, name);
  }

  return names;
}

const config = {
  db: {
    host: env('DB_HOST', '192.168.1.10'),
    port: envInt('DB_PORT', 1433),
    user: env('DB_USER', 'sa'),
    password: process.env.DB_PASSWORD ?? '',
    database: env('DB_NAME', 'attendance_db'),
    encrypt: envBool('DB_ENCRYPT', false),
    trustServerCertificate: envBool('DB_TRUST_SERVER_CERTIFICATE', true),
    connectionTimeoutMs: envInt('DB_CONNECTION_TIMEOUT_MS', 15000),
    requestTimeoutMs: envInt('DB_REQUEST_TIMEOUT_MS', 30000),
  },
  telegram: {
    token: env('TG_TOKEN'),
    pollTimeoutSec: envInt('TG_POLL_TIMEOUT_SEC', 30),
    notifyToken: env('TG_NOTIFY_TOKEN'),
    notifyChat: env('TG_NOTIFY_CHAT'),
  },
  allowedChats: env('ALLOWED_CHATS')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  deptHeads: parseDeptHeads(env('DEPT_HEADS')),
  chatNames: parseChatNames(env('TG_CHAT_NAMES')),
  excludeDepartments: env('EXCLUDE_DEPARTMENTS')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  lateToleranceMin: envInt('LATE_TOLERANCE_MIN', 10),
  checkoutNearMin: envInt('CHECKOUT_NEAR_MIN', 60),
  overtimeMinMinutes: envInt('LEMBUR_MIN_MEN', 240),
  scheduleFromDb: envBool('SCHEDULE_FROM_DB', true),
  baselineDays: envInt('BASELINE_DAYS', 30),
  zkWeekdayMondayIs1: envBool('ZK_WEEKDAY_MONDAY_IS_1', true),
  tz: env('TZ', 'Asia/Jakarta'),
};

function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function validateConfig(value = config) {
  const errors = [];

  if (!value.telegram.token) errors.push('TG_TOKEN belum diisi.');
  if (!value.db.host) errors.push('DB_HOST belum diisi.');
  if (!value.db.user) errors.push('DB_USER belum diisi.');
  if (!value.db.database) errors.push('DB_NAME belum diisi.');

  if (!Number.isInteger(value.db.port) || value.db.port < 1 || value.db.port > 65535) {
    errors.push('DB_PORT harus berupa angka 1-65535.');
  }
  if (!Number.isInteger(value.db.connectionTimeoutMs) || value.db.connectionTimeoutMs < 1000) {
    errors.push('DB_CONNECTION_TIMEOUT_MS minimal 1000.');
  }
  if (!Number.isInteger(value.db.requestTimeoutMs) || value.db.requestTimeoutMs < 1000) {
    errors.push('DB_REQUEST_TIMEOUT_MS minimal 1000.');
  }
  if (!Number.isInteger(value.telegram.pollTimeoutSec) || value.telegram.pollTimeoutSec < 5 || value.telegram.pollTimeoutSec > 50) {
    errors.push('TG_POLL_TIMEOUT_SEC harus berupa angka 5-50.');
  }
  if (!Number.isInteger(value.lateToleranceMin) || value.lateToleranceMin < 0) {
    errors.push('LATE_TOLERANCE_MIN harus berupa angka >= 0.');
  }
  if (
    !Number.isInteger(value.checkoutNearMin) ||
    value.checkoutNearMin < 0 ||
    value.checkoutNearMin > 1440
  ) {
    errors.push('CHECKOUT_NEAR_MIN harus berupa angka 0-1440.');
  }
  if (!Number.isInteger(value.overtimeMinMinutes) || value.overtimeMinMinutes < 0) {
    errors.push('LEMBUR_MIN_MEN harus berupa angka >= 0.');
  }
  if (!Number.isInteger(value.baselineDays) || value.baselineDays < 1 || value.baselineDays > 3650) {
    errors.push('BASELINE_DAYS harus berupa angka 1-3650.');
  }
  if (!isValidTimeZone(value.tz)) {
    errors.push(`TZ tidak valid: ${value.tz}`);
  }

  return errors;
}

if (isValidTimeZone(config.tz)) {
  // Berguna untuk modul lain yang memakai Date lokal.
  process.env.TZ = config.tz;
}

module.exports = config;
module.exports.parseEnv = parseEnv;
module.exports.parseDeptHeads = parseDeptHeads;
module.exports.parseChatNames = parseChatNames;
module.exports.validate = validateConfig;
