'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addDays,
  daysInMonth,
  formatDateLong,
  formatMonthLong,
  formatTime,
  looksLikeMonth,
  minutesToTime,
  monthDates,
  parseDateArg,
  parseMonthArg,
  timeToMinutes,
  todayInTz,
  zkWeekday,
} = require('../src/dates');

test('parseDateArg menerima format YYYY-MM-DD dan DD-MM-YYYY', () => {
  assert.equal(parseDateArg('2026-11-02', 'Asia/Jakarta'), '2026-11-02');
  assert.equal(parseDateArg('02-11-2026', 'Asia/Jakarta'), '2026-11-02');
  assert.equal(parseDateArg('2-11-2026', 'Asia/Jakarta'), '2026-11-02');
});

test('parseDateArg menolak tanggal yang tidak ada', () => {
  assert.equal(parseDateArg('2026-02-30', 'Asia/Jakarta'), null);
  assert.equal(parseDateArg('31-04-2026', 'Asia/Jakarta'), null);
  assert.equal(parseDateArg('bukan tanggal', 'Asia/Jakarta'), null);
});

test('parseDateArg tanpa argumen memakai tanggal hari ini di zona waktu', () => {
  assert.match(parseDateArg('', 'Asia/Jakarta'), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(todayInTz('Asia/Jakarta'), /^\d{4}-\d{2}-\d{2}$/);
});

test('parseMonthArg menerima format YYYY-MM dan MM-YYYY', () => {
  assert.equal(parseMonthArg('2026-11', 'Asia/Jakarta'), '2026-11');
  assert.equal(parseMonthArg('11-2026', 'Asia/Jakarta'), '2026-11');
  assert.equal(parseMonthArg('2026-13', 'Asia/Jakarta'), null);
  assert.equal(parseMonthArg('13-2026', 'Asia/Jakarta'), null);
  assert.equal(parseMonthArg('bukan bulan', 'Asia/Jakarta'), null);
  assert.equal(
    parseMonthArg('', 'Asia/Jakarta'),
    todayInTz('Asia/Jakarta').slice(0, 7),
  );
});

test('looksLikeMonth membedakan bulan dari tanggal lengkap', () => {
  assert.equal(looksLikeMonth('2026-11'), true);
  assert.equal(looksLikeMonth('11-2026'), true);
  assert.equal(looksLikeMonth('2026-11-02'), false);
  assert.equal(looksLikeMonth('Budi'), false);
});

test('monthDates dan formatMonthLong mengikuti jumlah hari bulan', () => {
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2024-02'), 29);
  assert.equal(daysInMonth('2026-11'), 30);

  const dates = monthDates('2026-11');
  assert.equal(dates.length, 30);
  assert.equal(dates[0], '2026-11-01');
  assert.equal(dates[29], '2026-11-30');
  assert.equal(formatMonthLong('2026-11'), 'November 2026');
});

test('addDays melewati batas bulan dan tahun', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
});

test('zkWeekday mengikuti konfigurasi Senin=1 atau Minggu=1', () => {
  // 2026-11-02 = Senin, 2026-11-07 = Sabtu, 2026-11-08 = Minggu
  assert.equal(zkWeekday('2026-11-02', true), 1);
  assert.equal(zkWeekday('2026-11-07', true), 6);
  assert.equal(zkWeekday('2026-11-08', true), 7);

  assert.equal(zkWeekday('2026-11-02', false), 2);
  assert.equal(zkWeekday('2026-11-07', false), 7);
  assert.equal(zkWeekday('2026-11-08', false), 1);
});

test('format tanggal dan waktu berbahasa Indonesia', () => {
  assert.equal(formatDateLong('2026-11-02'), 'Senin, 02 November 2026');
  assert.equal(timeToMinutes('08:05:30'), 485);
  assert.equal(formatTime('08:05:30'), '08:05');
  assert.equal(minutesToTime(485), '08:05');
  assert.equal(timeToMinutes('tidak valid'), null);
});
