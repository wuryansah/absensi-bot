'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const report = require('../src/report');
const { splitMessage, stripHtml } = require('../src/telegram');

function employee(overrides = {}) {
  return {
    userId: '1',
    badgeNumber: '',
    name: 'Budi',
    deptName: 'IT',
    firstIn: null,
    lastOut: null,
    punchCount: 0,
    shiftStart: '08:00',
    shiftEnd: '17:00',
    source: 'jadwal',
    estimated: false,
    deltaMinutes: null,
    lateMinutes: 0,
    isLate: false,
    expected: true,
    status: 'belum',
    ...overrides,
  };
}

function makeDay(employees, date = '2026-11-02') {
  const present = employees.filter((item) => item.status !== 'belum');
  const absent = employees.filter((item) => item.expected && item.status === 'belum');
  const late = employees.filter((item) => item.isLate);
  const expected = employees.filter((item) => item.expected);

  return {
    date,
    employees,
    present,
    absent,
    late,
    expected,
    stats: {
      total: expected.length,
      hadir: present.length,
      tepatWaktu: employees.filter((item) => item.status === 'hadir').length,
      terlambat: late.length,
      belum: absent.length,
    },
  };
}

test('todayReport menampilkan ringkasan, keterlambatan, dan yang belum absen', () => {
  const day = makeDay([
    employee({ userId: '1', name: 'Ani', firstIn: '07:55', status: 'hadir', deltaMinutes: -5 }),
    employee({
      userId: '2',
      name: 'Budi',
      firstIn: '08:30',
      status: 'terlambat',
      isLate: true,
      lateMinutes: 30,
      deltaMinutes: 30,
    }),
    employee({ userId: '3', name: 'Citra', status: 'belum' }),
  ]);

  const text = report.todayReport(day);
  assert.match(text, /Hadir: <b>2<\/b>/);
  assert.match(text, /Terlambat: <b>1<\/b>/);
  assert.match(text, /Belum absen: <b>1<\/b>/);
  assert.match(text, /Budi/);
  assert.match(text, /Citra/);
});

test('lateReport mengelompokkan per departemen dan urut nama', () => {
  const day = makeDay([
    employee({
      userId: '1',
      name: 'Budi',
      deptName: 'IT',
      firstIn: '08:45',
      status: 'terlambat',
      isLate: true,
      lateMinutes: 45,
      deltaMinutes: 45,
    }),
    employee({
      userId: '2',
      name: 'Ani',
      deptName: 'IT',
      firstIn: '08:10',
      status: 'terlambat',
      isLate: true,
      lateMinutes: 10,
      deltaMinutes: 10,
    }),
    employee({
      userId: '3',
      name: 'Citra',
      deptName: 'HR',
      firstIn: '08:20',
      status: 'terlambat',
      isLate: true,
      lateMinutes: 20,
      deltaMinutes: 20,
    }),
  ]);

  const text = report.lateReport(day);
  assert.match(text, /🏢 HR \(1\)/);
  assert.match(text, /🏢 IT \(2\)/);
  assert.ok(text.indexOf('Citra') < text.indexOf('Ani'));
  assert.ok(text.indexOf('Ani') < text.indexOf('Budi'));
  assert.match(text, /\+45 mnt/);
});

test('baris estimasi diberi bintang dan label estimasi', () => {
  const day = makeDay([
    employee({
      userId: '1',
      name: 'Ani',
      estimated: true,
      source: 'estimasi',
      shiftEnd: null,
      status: 'belum',
    }),
  ]);

  const text = report.absentReport(day);
  assert.match(text, /\* 1\./);
  assert.match(text, /estimasi/);
  assert.match(text, /median 30 hari/);
});

test('presentReport mengelompokkan per departemen dan urut nama', () => {
  const day = makeDay([
    employee({ userId: '1', name: 'Budi', deptName: 'IT', firstIn: '08:05', status: 'hadir' }),
    employee({ userId: '2', name: 'Ani', deptName: 'IT', firstIn: '07:45', status: 'hadir' }),
    employee({ userId: '3', name: 'Citra', deptName: 'HR', firstIn: '08:30', status: 'hadir' }),
  ]);

  const text = report.presentReport(day);
  assert.match(text, /🏢 HR \(1\)/);
  assert.match(text, /🏢 IT \(2\)/);
  assert.ok(text.indexOf('Citra') < text.indexOf('Ani'));
  assert.ok(text.indexOf('Ani') < text.indexOf('Budi'));
});

test('presentReport menandai hadir tanpa absen masuk', () => {
  const day = makeDay([
    employee({
      userId: '1',
      name: 'Ani',
      firstIn: null,
      lastOut: '17:04',
      punchCount: 1,
      missingIn: true,
      status: 'hadir_tanpa_masuk',
    }),
  ]);

  const text = report.presentReport(day);
  assert.match(text, /pulang 17:04/);
  assert.match(text, /tanpa absen masuk/);
});

test('employeeReport menampilkan detail keterlambatan', () => {
  const day = makeDay([
    employee({
      userId: '2',
      name: 'Budi',
      firstIn: '08:30',
      lastOut: '17:10',
      status: 'terlambat',
      isLate: true,
      lateMinutes: 30,
      deltaMinutes: 30,
      punchCount: 2,
    }),
  ]);

  const text = report.employeeReport(day, day.employees[0]);
  assert.match(text, /Terlambat/);
  assert.match(text, /Keterlambatan: <b>30 menit<\/b>/);
  assert.match(text, /08:00–17:00/);
  assert.match(text, /Pulang: 17:10/);
  assert.match(text, /Jumlah punch: 2/);
});

test('employeeReport tidak menyebut pulang jika baru satu punch', () => {
  const day = makeDay([
    employee({
      userId: '2',
      name: 'Budi',
      firstIn: '08:00',
      lastOut: '08:00',
      status: 'hadir',
      punchCount: 1,
    }),
  ]);

  const text = report.employeeReport(day, day.employees[0]);
  assert.match(text, /Pulang: belum ada punch keluar/);
  assert.doesNotMatch(text, /Pulang: 08:00/);
});

test('employeeReport menjelaskan punch dekat jam pulang', () => {
  const day = makeDay([
    employee({
      userId: '2',
      name: 'Budi',
      firstIn: null,
      lastOut: '17:04',
      punchCount: 1,
      missingIn: true,
      status: 'hadir_tanpa_masuk',
    }),
  ]);

  const text = report.employeeReport(day, day.employees[0]);
  assert.match(text, /Hadir tanpa absen masuk/);
  assert.match(text, /Masuk: <b>tidak ada<\/b>/);
  assert.match(text, /Pulang: 17:04/);
  assert.match(text, /60 menit sebelum jam pulang/);
});

test('departmentReport mengelompokkan per departemen', () => {
  const day = makeDay([
    employee({ userId: '1', name: 'Ani', deptName: 'IT', firstIn: '07:55', status: 'hadir' }),
    employee({ userId: '2', name: 'Budi', deptName: 'IT', status: 'belum' }),
    employee({ userId: '3', name: 'Citra', deptName: 'HR', firstIn: '08:15', status: 'hadir' }),
  ]);

  const text = report.departmentReport(day);
  assert.match(text, /<b>HR<\/b> — 1 karyawan/);
  assert.match(text, /<b>IT<\/b> — 2 karyawan/);
  assert.match(text, /✅ 1 hadir · ❌ 1 belum/);
});

test('weekReport menampilkan tujuh hari dan total', () => {
  const days = [];
  for (let index = 0; index < 7; index += 1) {
    days.push(
      makeDay([
        employee({ userId: '1', name: 'Ani', firstIn: '07:55', status: 'hadir' }),
        employee({ userId: '2', name: 'Budi', status: 'belum' }),
      ]),
    );
  }

  const text = report.weekReport(days);
  assert.match(text, /Ringkasan 7 Hari Terakhir/);
  assert.match(text, /Total 7 hari/);
  assert.match(text, /Rata-rata: 1 hadir\/hari/);
});

test('monthReport merangkum kehadiran sebulan per karyawan dan departemen', () => {
  const days = [
    makeDay(
      [
        employee({
          userId: '1',
          name: 'Ani',
          firstIn: '07:55',
          lastOut: '17:00',
          punchCount: 2,
          status: 'hadir',
        }),
        employee({
          userId: '2',
          name: 'Budi',
          firstIn: '08:30',
          lastOut: '17:10',
          punchCount: 2,
          status: 'terlambat',
          isLate: true,
          lateMinutes: 30,
          deltaMinutes: 30,
        }),
        employee({ userId: '3', name: 'Citra', deptName: 'HR', status: 'belum' }),
      ],
      '2026-11-02',
    ),
    makeDay(
      [
        employee({
          userId: '1',
          name: 'Ani',
          firstIn: '07:58',
          lastOut: '17:05',
          punchCount: 2,
          status: 'hadir',
        }),
        employee({ userId: '2', name: 'Budi', status: 'belum' }),
        employee({
          userId: '3',
          name: 'Citra',
          deptName: 'HR',
          firstIn: '08:05',
          lastOut: '08:05',
          punchCount: 1,
          status: 'hadir',
        }),
      ],
      '2026-11-03',
    ),
  ];

  const text = report.monthReport('2026-11', days);
  assert.match(text, /Rekap Absensi Bulanan/);
  assert.match(text, /November 2026/);
  assert.match(text, /Kehadiran: <b>4<\/b> \(3 tepat waktu · 1 terlambat\)/);
  assert.match(text, /Belum absen: <b>2<\/b>/);
  assert.match(text, /Tanpa absen pulang: <b>1<\/b>/);
  assert.match(text, /Karyawan: <b>3<\/b>/);
  assert.match(text, /Rata-rata hadir: <b>2<\/b>\/hari/);
  assert.match(text, /<b>HR<\/b> — 1 karyawan/);
  assert.match(text, /<b>IT<\/b> — 2 karyawan/);
  assert.match(text, /1\. <b>Budi<\/b> — IT · 1 hari · total 30 mnt/);
  assert.match(text, /Paling Sering Tidak Absen/);
  assert.match(text, /Paling Sering Tanpa Absen Pulang/);
  assert.match(text, /1\. <b>Citra<\/b> — HR · 1 hari/);
});

test('monthReport menangani bulan tanpa data', () => {
  const text = report.monthReport('2026-12', []);
  assert.match(text, /Desember 2026/);
  assert.match(text, /Belum ada data absensi/);
});

test('employeeMonthReport menampilkan ringkasan dan rincian harian', () => {
  const days = [
    makeDay(
      [
        employee({
          userId: '2',
          name: 'Budi',
          firstIn: '08:30',
          lastOut: '17:10',
          punchCount: 2,
          status: 'terlambat',
          isLate: true,
          lateMinutes: 30,
          deltaMinutes: 30,
        }),
      ],
      '2026-11-02',
    ),
    makeDay(
      [
        employee({ userId: '2', name: 'Budi', status: 'belum' }),
      ],
      '2026-11-03',
    ),
  ];

  const text = report.employeeMonthReport('2026-11', days, days[0].employees[0]);
  assert.match(text, /Budi/);
  assert.match(text, /Hadir: <b>1<\/b> hari \(0 tepat waktu · 1 terlambat\)/);
  assert.match(text, /Belum absen: <b>1<\/b> hari/);
  assert.match(text, /Tanpa absen pulang: <b>0<\/b> hari/);
  assert.match(text, /Total keterlambatan: <b>30 menit<\/b>/);
  assert.match(text, /Rata-rata masuk: <b>08:30<\/b>/);
  assert.match(text, /Rata-rata pulang: <b>17:10<\/b>/);
  assert.match(text, /Sen, 02 Nov 2026 — ⏰ masuk 08:30 \(\+30 mnt\) · pulang 17:10/);
  assert.match(text, /Sel, 03 Nov 2026 — ❌ belum absen/);
});

test('helpText memuat semua perintah utama', () => {
  const text = report.helpText();
  for (const command of ['/menu', '/today', '/terlambat', '/absen', '/hadir', '/masuk', '/cek', '/rekap', '/minggu', '/bulan', '/id']) {
    assert.ok(text.includes(command), `help tidak memuat ${command}`);
  }
});

test('menuKeyboard memuat tombol untuk semua perintah data', () => {
  const buttons = report.menuKeyboard().inline_keyboard.flat();
  const data = buttons.map((button) => button.callback_data);

  for (const command of ['today', 'terlambat', 'hadir', 'absen', 'rekap', 'minggu', 'bulan', 'cek', 'id']) {
    assert.ok(data.includes(`cmd:${command}`), `menu tidak memuat ${command}`);
  }

  assert.ok(buttons.every((button) => button.text.length > 0));
  assert.ok(buttons.every((button) => button.callback_data.length <= 64));
});

test('menuText menjelaskan cara memakai menu', () => {
  const text = report.menuText();
  assert.match(text, /Menu Bot Absensi/);
  assert.match(text, /tanggal lain/i);
});

test('splitMessage memecah pesan panjang tanpa menghilangkan baris', () => {
  const lines = Array.from({ length: 300 }, (_, index) => `Baris ${index} ${'x'.repeat(20)}`);
  const text = lines.join('\n');
  const chunks = splitMessage(text, 1000);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 1000));
  assert.equal(chunks.join('\n'), text);
});

test('stripHtml membersihkan tag dan entity', () => {
  assert.equal(stripHtml('<b>Halo</b> &amp; <i>dunia</i>'), 'Halo & dunia');
});
