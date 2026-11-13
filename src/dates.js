'use strict';

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const SHORT_DAY_NAMES = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTH_NAMES = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];
const SHORT_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function pad2(value) {
  return String(value).padStart(2, '0');
}

function todayInTz(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function isValidYmd(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function looksLikeDate(value) {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{1,2}-\d{1,2}$/.test(text) || /^\d{1,2}-\d{1,2}-\d{4}$/.test(text);
}

/**
 * Mengembalikan tanggal kanonik YYYY-MM-DD, atau null jika format tidak valid.
 * Tanpa argumen mengembalikan tanggal hari ini menurut zona waktu bot.
 */
function parseDateArg(value, timeZone) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return todayInTz(timeZone);
  }

  const text = String(value).trim();
  let year;
  let month;
  let day;

  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(text);
    if (!match) return null;
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  }

  if (!isValidYmd(year, month, day)) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function looksLikeMonth(value) {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{1,2}$/.test(text) || /^\d{1,2}-\d{4}$/.test(text);
}

/**
 * Mengembalikan bulan kanonik YYYY-MM, atau null jika format tidak valid.
 * Tanpa argumen mengembalikan bulan berjalan menurut zona waktu bot.
 */
function parseMonthArg(value, timeZone) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return todayInTz(timeZone).slice(0, 7);
  }

  const text = String(value).trim();
  let year;
  let month;

  let match = /^(\d{4})-(\d{1,2})$/.exec(text);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
  } else {
    match = /^(\d{1,2})-(\d{4})$/.exec(text);
    if (!match) return null;
    month = Number(match[1]);
    year = Number(match[2]);
  }

  if (!Number.isInteger(year) || year < 1900 || year > 9999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return `${year}-${pad2(month)}`;
}

function dateParts(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return { year, month, day };
}

function monthParts(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  return { year, month };
}

function daysInMonth(monthStr) {
  const { year, month } = monthParts(monthStr);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthDates(monthStr) {
  const total = daysInMonth(monthStr);
  return Array.from({ length: total }, (_, index) => `${monthStr}-${pad2(index + 1)}`);
}

function formatMonthLong(monthStr) {
  const { year, month } = monthParts(monthStr);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function addDays(dateStr, amount) {
  const { year, month, day } = dateParts(dateStr);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function dayIndex(dateStr) {
  const { year, month, day } = dateParts(dateStr);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function dayName(dateStr) {
  return DAY_NAMES[dayIndex(dateStr)];
}

function shortDayName(dateStr) {
  return SHORT_DAY_NAMES[dayIndex(dateStr)];
}

function formatDateLong(dateStr) {
  const { year, month, day } = dateParts(dateStr);
  return `${dayName(dateStr)}, ${pad2(day)} ${MONTH_NAMES[month - 1]} ${year}`;
}

function formatDateShort(dateStr) {
  const { year, month, day } = dateParts(dateStr);
  return `${pad2(day)} ${SHORT_MONTH_NAMES[month - 1]} ${year}`;
}

function formatDateShortWithDay(dateStr) {
  return `${shortDayName(dateStr)}, ${formatDateShort(dateStr)}`;
}

/**
 * Konversi hari JavaScript (0=Minggu ... 6=Sabtu) ke SDAYS ZKTeco.
 */
function zkWeekday(dateStr, mondayIs1) {
  const index = dayIndex(dateStr);
  return mondayIs1 ? (index === 0 ? 7 : index) : index + 1;
}

function timeToMinutes(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;

  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(value).trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) return null;
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`;
}

function formatTime(value) {
  const minutes = timeToMinutes(value);
  return minutes === null ? null : minutesToTime(minutes);
}

function dateRange(dateStr) {
  // Format dengan "T" adalah ISO 8601 yang tidak bergantung pada SET LANGUAGE
  // SQL Server, berbeda dengan "YYYY-MM-DD HH:mm:ss" biasa.
  return {
    start: `${dateStr}T00:00:00`,
    end: `${addDays(dateStr, 1)}T00:00:00`,
  };
}

module.exports = {
  DAY_NAMES,
  SHORT_DAY_NAMES,
  MONTH_NAMES,
  SHORT_MONTH_NAMES,
  pad2,
  todayInTz,
  isValidYmd,
  looksLikeDate,
  parseDateArg,
  looksLikeMonth,
  parseMonthArg,
  daysInMonth,
  monthDates,
  formatMonthLong,
  addDays,
  dayIndex,
  dayName,
  shortDayName,
  formatDateLong,
  formatDateShort,
  formatDateShortWithDay,
  zkWeekday,
  timeToMinutes,
  minutesToTime,
  formatTime,
  dateRange,
};
