'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Ganti modul db dengan query tiruan sebelum schedule.js dimuat.
const dbPath = require.resolve('../src/db');
const employees = [
  { userId: 1, badgeNumber: 'A001', name: 'Ani', deptId: 1, deptName: 'IT' },
  { userId: 2, badgeNumber: 'A002', name: 'Budi', deptId: 1, deptName: 'IT' },
  { userId: 3, badgeNumber: 'A003', name: 'Citra', deptId: 2, deptName: 'HR' },
  { userId: 4, badgeNumber: 'A004', name: 'Dodi', deptId: 3, deptName: 'Ops' },
];

const schedules = [
  { userId: 1, shiftStart: '08:00:00', shiftEnd: '17:00:00' },
  { userId: 2, shiftStart: '08:00:00', shiftEnd: '17:00:00' },
  { userId: 3, shiftStart: '08:30:00', shiftEnd: '17:00:00' },
];

const baselineRows = [];
for (let offset = 1; offset <= 30; offset += 1) {
  baselineRows.push({
    userId: 4,
    workDate: `2026-10-${String(offset).padStart(2, '0')}`,
    firstIn: '07:50:00',
  });
}

const punches = [
  { userId: 1, firstIn: '07:55:00', lastOut: '17:00:00', punchCount: 2 },
  { userId: 2, firstIn: '08:15:00', lastOut: '17:05:00', punchCount: 2 },
  { userId: 4, firstIn: '07:45:00', lastOut: '16:00:00', punchCount: 2 },
];

const punchRows = [
  { userId: 1, punchAt: '2026-11-02 07:55:00', checkType: 'I' },
  { userId: 1, punchAt: '2026-11-02 17:00:00', checkType: 'O' },
  { userId: 2, punchAt: '2026-11-02 08:15:00', checkType: 'I' },
  { userId: 2, punchAt: '2026-11-02 17:05:00', checkType: 'O' },
  { userId: 4, punchAt: '2026-11-02 07:45:00', checkType: 'I' },
  { userId: 4, punchAt: '2026-11-02 16:00:00', checkType: 'O' },
  { userId: 1, punchAt: '2026-11-04 17:04:00', checkType: 'O' },
  { userId: 2, punchAt: '2026-11-04 16:30:00', checkType: 'I' },
];

let schedulesAvailable = true;

const fakeQuery = async (text, params = {}) => {
  if (text.includes('FROM USERINFO')) return employees;
  if (text.includes('FROM USER_OF_RUN')) {
    if (!schedulesAvailable) throw new Error('jadwal offline');
    return schedules;
  }
  if (text.includes('AS punchAt')) {
    const start = String(params.dateStart || '').slice(0, 10);
    const end = String(params.dateEnd || '').slice(0, 10);
    return punchRows.filter((row) => {
      const date = row.punchAt.slice(0, 10);
      return date >= start && date < end;
    });
  }
  if (text.includes('COUNT(*) AS punchCount')) return punches;
  if (text.includes('FROM CHECKINOUT ci')) return baselineRows;
  throw new Error(`Query tidak dikenal: ${text}`);
};

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { query: fakeQuery },
};

const {
  buildBaselineMap,
  buildDay,
  findEmployees,
  median,
  summarizeMonth,
} = require('../src/schedule');

test('median menghitung nilai tengah', () => {
  assert.equal(median([480, 500, 490]), 490);
  assert.equal(median([480, 500]), 490);
  assert.equal(median([]), null);
});

test('buildBaselineMap hanya memakai jendela baseline', () => {
  const rows = [
    { userId: 1, workDate: '2026-11-01', firstIn: '08:00:00' },
    { userId: 1, workDate: '2026-10-31', firstIn: '08:10:00' },
    { userId: 1, workDate: '2026-09-01', firstIn: '09:00:00' },
  ];

  const result = buildBaselineMap(rows, '2026-11-02', 30);
  assert.equal(result.get('1'), 485);
});

test('buildDay menggabungkan jadwal, punch, dan statistik', async () => {
  const day = await buildDay('2026-11-02');

  assert.equal(day.stats.total, 3);
  assert.equal(day.stats.hadir, 2);
  assert.equal(day.stats.tepatWaktu, 1);
  assert.equal(day.stats.terlambat, 1);
  assert.equal(day.stats.belum, 1);
  assert.equal(day.stats.lembur, 1);

  const byId = new Map(day.employees.map((employee) => [employee.userId, employee]));

  assert.equal(byId.get('1').source, 'jadwal');
  assert.equal(byId.get('1').status, 'hadir');
  assert.equal(byId.get('2').status, 'terlambat');
  assert.equal(byId.get('2').lateMinutes, 15);
  assert.equal(byId.get('3').status, 'belum');
  assert.equal(byId.get('4').source, null);
  assert.equal(byId.get('4').status, 'lembur');
});

test('buildDay memakai baseline saat jadwal database tidak tersedia', async () => {
  schedulesAvailable = false;
  try {
    const day = await buildDay('2026-11-02');
    const dodi = day.employees.find((employee) => employee.userId === '4');

    assert.equal(dodi.source, 'estimasi');
    assert.equal(dodi.shiftStart, '07:50');
    assert.equal(dodi.status, 'hadir');
    assert.equal(dodi.estimated, true);
  } finally {
    schedulesAvailable = true;
  }
});

test('buildDay menganggap punch dekat jam pulang sebagai absen pulang', async () => {
  const day = await buildDay('2026-11-04');
  const byId = new Map(day.employees.map((employee) => [employee.userId, employee]));

  const satu = byId.get('1');
  assert.equal(satu.status, 'hadir_tanpa_masuk');
  assert.equal(satu.missingIn, true);
  assert.equal(satu.firstIn, null);
  assert.equal(satu.lastOut, '17:04');
  assert.equal(satu.lateMinutes, 0);
  assert.equal(satu.isLate, false);

  const dua = byId.get('2');
  assert.equal(dua.status, 'hadir_tanpa_masuk');
  assert.equal(dua.firstIn, null);
  assert.equal(dua.lastOut, '16:30');

  assert.equal(day.stats.tanpaMasuk, 2);
  assert.equal(day.stats.hadir, 2);
  assert.equal(day.stats.tepatWaktu, 0);
  assert.equal(day.stats.terlambat, 0);
});

test('summarizeMonth menjumlahkan kehadiran per karyawan dan departemen', () => {
  const days = [
    {
      stats: { total: 2, hadir: 1, terlambat: 1, belum: 1 },
      employees: [
        {
          userId: '1',
          badgeNumber: 'A001',
          name: 'Ani',
          deptName: 'IT',
          expected: true,
          status: 'terlambat',
          isLate: true,
          lateMinutes: 20,
          firstIn: '08:20',
          lastOut: '17:10',
          punchCount: 2,
        },
        {
          userId: '2',
          badgeNumber: 'A002',
          name: 'Budi',
          deptName: 'IT',
          expected: true,
          status: 'belum',
          isLate: false,
          lateMinutes: 0,
          firstIn: null,
        },
      ],
    },
    {
      stats: { total: 2, hadir: 2, terlambat: 0, belum: 0 },
      employees: [
        {
          userId: '1',
          badgeNumber: 'A001',
          name: 'Ani',
          deptName: 'IT',
          expected: true,
          status: 'hadir',
          isLate: false,
          lateMinutes: 0,
          firstIn: '07:50',
          lastOut: '17:00',
          punchCount: 2,
        },
        {
          userId: '2',
          badgeNumber: 'A002',
          name: 'Budi',
          deptName: 'IT',
          expected: true,
          status: 'hadir',
          isLate: false,
          lateMinutes: 0,
          firstIn: '08:00',
          lastOut: '08:00',
          punchCount: 1,
        },
      ],
    },
  ];

  const summary = summarizeMonth(days);
  assert.deepEqual(summary.stats, {
    hadir: 3,
    terlambat: 1,
    tanpaMasuk: 0,
    belum: 1,
    total: 4,
    missingOut: 1,
    libur: 0,
    lembur: 0,
    tukarOff: 0,
    hadirTanpaJadwal: 0,
    lemburMinutes: 0,
  });

  const ani = summary.employees.find((employee) => employee.userId === '1');
  assert.equal(ani.presentDays, 2);
  assert.equal(ani.lateDays, 1);
  assert.equal(ani.absentDays, 0);
  assert.equal(ani.averageFirstIn, 485);
  assert.equal(ani.missingOutDays, 0);
  assert.equal(ani.averageLastOut, 1025);

  const budi = summary.employees.find((employee) => employee.userId === '2');
  assert.equal(budi.presentDays, 1);
  assert.equal(budi.absentDays, 1);
  assert.equal(budi.missingOutDays, 1);
  assert.equal(budi.averageLastOut, null);

  assert.equal(summary.departments.length, 1);
  assert.equal(summary.departments[0].employeeCount, 2);
  assert.equal(summary.departments[0].present, 3);
  assert.equal(summary.departments[0].late, 1);
  assert.equal(summary.departments[0].absent, 1);
  assert.equal(summary.departments[0].missingOut, 1);
});

test('summarizeMonth memisahkan tanpa absen masuk dari tanpa absen pulang', () => {
  const summary = summarizeMonth([
    {
      stats: { total: 1, hadir: 1, terlambat: 0, tanpaMasuk: 1, belum: 0 },
      employees: [
        {
          userId: '1',
          badgeNumber: 'A001',
          name: 'Ani',
          deptName: 'IT',
          expected: true,
          status: 'hadir_tanpa_masuk',
          missingIn: true,
          isLate: false,
          lateMinutes: 0,
          firstIn: null,
          lastOut: '17:04',
          punchCount: 1,
        },
      ],
    },
  ]);

  assert.equal(summary.stats.tanpaMasuk, 1);
  assert.equal(summary.stats.missingOut, 0);

  const ani = summary.employees[0];
  assert.equal(ani.missingInDays, 1);
  assert.equal(ani.missingOutDays, 0);
  assert.equal(ani.averageFirstIn, null);
  assert.equal(ani.averageLastOut, 1024);
});

test('findEmployees mencari berdasarkan id, NIP, dan nama', () => {
  const day = {
    employees: [
      {
        userId: '1',
        badgeNumber: 'A001',
        name: 'Ani',
        deptName: 'IT',
      },
      {
        userId: '2',
        badgeNumber: 'A002',
        name: 'Budi Santoso',
        deptName: 'IT',
      },
    ],
  };

  assert.equal(findEmployees(day, '2').length, 1);
  assert.equal(findEmployees(day, 'A002')[0].name, 'Budi Santoso');
  assert.equal(findEmployees(day, 'budi')[0].userId, '2');
  assert.equal(findEmployees(day, 'tidak ada').length, 0);
});
