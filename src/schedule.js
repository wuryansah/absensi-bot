'use strict';

const config = require('./config');
const { query } = require('./db');
const {
  addDays,
  dateRange,
  dayIndex,
  formatTime,
  minutesToTime,
  monthDates,
  timeToMinutes,
  todayInTz,
} = require('./dates');

const DAY_MINUTES = 1440;
const WORKED_STATUSES = new Set(['hadir', 'hadir_tanpa_masuk', 'terlambat', 'lembur', 'tukar_off']);

let scheduleWarningLogged = false;

function isSaturday(dateStr) {
  return dayIndex(dateStr) === 6;
}

function isOvernightShift(shiftStart, shiftEnd) {
  const start = timeToMinutes(shiftStart);
  const end = timeToMinutes(shiftEnd);
  if (start === null || end === null) return false;
  return end <= start;
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function getEmployees() {
  const rows = await query(`
    SELECT
      u.USERID AS userId,
      u.BADGENUMBER AS badgeNumber,
      u.NAME AS name,
      u.DEFAULTDEPTID AS deptId,
      ISNULL(d.DEPTNAME, N'Tanpa Departemen') AS deptName
    FROM USERINFO u
    LEFT JOIN DEPARTMENTS d ON d.DEPTID = u.DEFAULTDEPTID
    WHERE u.USERID IS NOT NULL
    ORDER BY u.NAME ASC, u.USERID ASC
  `);

  const excluded = new Set(config.excludeDepartments.map(normalizeText));

  return rows
    .map((row) => ({
      userId: String(row.userId),
      badgeNumber: row.badgeNumber === null || row.badgeNumber === undefined
        ? ''
        : String(row.badgeNumber).trim(),
      name: String(row.name || `User ${row.userId}`).trim(),
      deptId: row.deptId === null || row.deptId === undefined ? '' : String(row.deptId),
      deptName: String(row.deptName || 'Tanpa Departemen').trim(),
    }))
    .filter((employee) => !excluded.has(normalizeText(employee.deptName)));
}

/**
 * Mengambil jadwal shift untuk satu tanggal.
 *
 * SDAYS pada ZKTeco bukan hari dalam seminggu, melainkan hari ke-N di dalam
 * siklus NUM_RUN. Siklus dihitung dari NUM_RUN.STARTDATE. Panjang siklus:
 * - CYLE * UNITS * 7 bila UNITS > 0 (misalnya 2 minggu = 14 hari)
 * - CYLE bila UNITS = 0 (misalnya siklus 8 hari untuk regu shift)
 *
 * Jika ada beberapa penugasan, dipilih yang STARTDATE-nya paling baru.
 *
 * Bila tanggal yang diminta lebih lama dari semua penugasan (misalnya jadwal
 * lama sudah dihapus dari database), penugasan terdekat yang mulai setelah
 * tanggal itu dipakai dan siklusnya diproyeksikan mundur. Jadwal hasil
 * proyeksi adalah perkiraan, bukan riwayat jadwal yang sebenarnya.
 */
async function getSchedules(dateStr) {
  const { start, end } = dateRange(dateStr);

  const rows = await query(
    `
      WITH cycles AS (
        SELECT
          r.NUM_RUNID AS runId,
          r.STARTDATE AS cycleStart,
          CASE
            WHEN ISNULL(r.UNITS, 0) > 0 THEN r.CYLE * r.UNITS * 7
            WHEN ISNULL(r.CYLE, 0) > 1 THEN r.CYLE
            ELSE 7
          END AS cycleLength
        FROM NUM_RUN r
      ),
      bounds AS (
        SELECT MIN(
          CASE WHEN ur.STARTDATE > '2001-01-01' THEN ur.STARTDATE END
        ) AS earliestStart
        FROM USER_OF_RUN ur
      ),
      ranked AS (
        SELECT
          ur.USERID AS userId,
          rd.STARTTIME AS startTime,
          rd.ENDTIME AS endTime,
          ROW_NUMBER() OVER (
            PARTITION BY ur.USERID
            ORDER BY
              CASE
                WHEN ur.STARTDATE IS NULL OR ur.STARTDATE < @dateEnd THEN 0
                WHEN @dateStart < (SELECT earliestStart FROM bounds) THEN 1
                ELSE 2
              END ASC,
              CASE
                WHEN ur.STARTDATE IS NULL OR ur.STARTDATE < @dateEnd
                  THEN ur.STARTDATE
              END DESC,
              CASE
                WHEN ur.STARTDATE >= @dateEnd THEN ur.STARTDATE
              END ASC,
              rd.STARTTIME ASC,
              ur.NUM_OF_RUN_ID DESC
          ) AS rn
        FROM USER_OF_RUN ur
        INNER JOIN cycles c
          ON c.runId = ur.NUM_OF_RUN_ID
        INNER JOIN NUM_RUN_DEIL rd
          ON rd.NUM_RUNID = ur.NUM_OF_RUN_ID
        WHERE (
            ur.ENDDATE IS NULL
            OR ur.ENDDATE >= @dateStart
            OR ur.ENDDATE < '1901-01-01'
          )
          AND (
            ur.STARTDATE IS NULL
            OR ur.STARTDATE < @dateEnd
            OR @dateStart < (SELECT earliestStart FROM bounds)
          )
          AND c.cycleLength > 0
          AND rd.SDAYS = (
            ((DATEDIFF(day, c.cycleStart, @dateStart) % c.cycleLength)
              + c.cycleLength) % c.cycleLength
          )
      )
      SELECT
        userId,
        CONVERT(varchar(8), startTime, 108) AS shiftStart,
        CONVERT(varchar(8), endTime, 108) AS shiftEnd
      FROM ranked
      WHERE rn = 1
    `,
    { dateStart: start, dateEnd: end },
  );

  const schedules = new Map();
  for (const row of rows) {
    const shiftStart = formatTime(row.shiftStart);
    if (!shiftStart) continue;

    schedules.set(String(row.userId), {
      shiftStart,
      shiftEnd: formatTime(row.shiftEnd),
      source: 'jadwal',
    });
  }

  return schedules;
}

/**
 * Absen masuk pertama per karyawan per hari pada rentang tertentu.
 * Dipakai untuk menghitung jam masuk tipikal (median).
 */
async function getFirstPunches(fromDate, toDateExclusive) {
  const rows = await query(
    `
      SELECT
        ci.USERID AS userId,
        CONVERT(varchar(10), ci.CHECKTIME, 120) AS workDate,
        CONVERT(varchar(8), MIN(ci.CHECKTIME), 108) AS firstIn
      FROM CHECKINOUT ci
      WHERE ci.CHECKTIME >= @fromDate
        AND ci.CHECKTIME < @toDate
      GROUP BY ci.USERID, CONVERT(varchar(10), ci.CHECKTIME, 120)
    `,
    {
      fromDate: `${fromDate}T00:00:00`,
      toDate: `${toDateExclusive}T00:00:00`,
    },
  );

  return rows.map((row) => ({
    userId: String(row.userId),
    workDate: String(row.workDate || '').slice(0, 10),
    firstIn: formatTime(row.firstIn),
  }));
}

function median(values) {
  if (!values.length) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * Menghitung median jam masuk per karyawan untuk jendela BASELINE_DAYS
 * sebelum tanggal yang diminta (tanggal itu sendiri tidak ikut).
 */
function buildBaselineMap(rows, dateStr, days) {
  const fromDate = addDays(dateStr, -days);
  const byUser = new Map();

  for (const row of rows) {
    if (!row.workDate || row.workDate < fromDate || row.workDate >= dateStr) continue;

    const minutes = timeToMinutes(row.firstIn);
    if (minutes === null) continue;

    const userId = String(row.userId);
    if (!byUser.has(userId)) byUser.set(userId, []);
    byUser.get(userId).push(minutes);
  }

  const medians = new Map();
  for (const [userId, values] of byUser) {
    medians.set(userId, median(values));
  }
  return medians;
}

/**
 * Mengambil punch mentah untuk tanggal yang diminta dan pagi hari berikutnya.
 * Jendela tambahan dipakai untuk shift malam 23:00-07:00 yang absen pulangnya
 * jatuh pada hari berikutnya.
 */
async function getPunchWindow(dateStr) {
  const start = `${dateStr}T00:00:00`;
  const end = `${addDays(dateStr, 1)}T18:00:00`;

  const rows = await query(
    `
      SELECT
        USERID AS userId,
        CONVERT(varchar(19), CHECKTIME, 120) AS punchAt,
        CHECKTYPE AS checkType
      FROM CHECKINOUT
      WHERE CHECKTIME >= @dateStart
        AND CHECKTIME < @dateEnd
      ORDER BY USERID ASC, CHECKTIME ASC
    `,
    { dateStart: start, dateEnd: end },
  );

  const nextDate = addDays(dateStr, 1);
  const punches = new Map();

  for (const row of rows) {
    const userId = String(row.userId);
    const punchAt = String(row.punchAt || '');
    const punchDate = punchAt.slice(0, 10);
    const minutes = timeToMinutes(punchAt.slice(11, 19));

    let dayOffset;
    if (punchDate === dateStr) dayOffset = 0;
    else if (punchDate === nextDate) dayOffset = 1;
    else continue;

    if (minutes === null) continue;

    if (!punches.has(userId)) punches.set(userId, []);
    punches.get(userId).push({
      checkType: String(row.checkType || '').trim().toUpperCase(),
      dayOffset,
      minutes,
      absMinutes: dayOffset * DAY_MINUTES + minutes,
    });
  }

  return punches;
}

/**
 * Ringkasan punch dari daftar baris punch. Bila CHECKTYPE tersedia, jam masuk
 * diambil dari punch "I" pertama dan jam pulang dari punch "O" terakhir.
 *
 * options.checkoutNearAbs: batas absolut (menit sejak awal hari) untuk punch
 * pulang. Punch pada atau setelah batas ini tidak dipakai sebagai jam masuk.
 * Bila tidak ada punch sebelum batas, hari itu dianggap hanya absen pulang
 * (missingIn), sehingga tidak dihitung terlambat.
 */
function summarizePunchRows(rows, options = {}) {
  if (!rows.length) return null;

  const ordered = [...rows].sort((a, b) => a.absMinutes - b.absMinutes);
  const checkoutNearAbs =
    Number.isFinite(options.checkoutNearAbs) ? options.checkoutNearAbs : null;
  const inRows =
    checkoutNearAbs === null
      ? ordered
      : ordered.filter((row) => row.absMinutes < checkoutNearAbs);

  if (checkoutNearAbs !== null && !inRows.length) {
    const lastOutRow = ordered[ordered.length - 1];
    return {
      firstIn: null,
      firstInAbs: null,
      lastOut: minutesToTime(lastOutRow.minutes),
      lastOutAbs: lastOutRow.absMinutes,
      punchCount: ordered.length,
      workedMinutes: null,
      missingIn: true,
    };
  }

  const hasType = ordered.some((row) => row.checkType === 'I' || row.checkType === 'O');
  const first = hasType
    ? inRows.find((row) => row.checkType === 'I') || inRows[0]
    : inRows[0];

  let lastOutRow = null;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const row = ordered[index];
    if (row.absMinutes < first.absMinutes) break;
    if (!hasType || row.checkType === 'O') {
      lastOutRow = row;
      break;
    }
  }

  return {
    firstIn: minutesToTime(first.minutes),
    firstInAbs: first.absMinutes,
    lastOut: lastOutRow ? minutesToTime(lastOutRow.minutes) : null,
    lastOutAbs: lastOutRow ? lastOutRow.absMinutes : null,
    punchCount: ordered.length,
    workedMinutes: lastOutRow
      ? Math.max(lastOutRow.absMinutes - first.absMinutes, 0)
      : null,
    missingIn: false,
  };
}

function sameDayRows(rows) {
  return rows.filter((row) => row.dayOffset === 0);
}

function hasCheckIn(rows) {
  if (!rows.length) return false;
  if (rows.some((row) => row.checkType === 'I')) return true;
  return !rows.some((row) => row.checkType === 'O');
}

/**
 * Punch untuk shift yang punya jadwal. Shift malam memakai jendela dari
 * beberapa jam sebelum shift mulai sampai beberapa jam setelah shift selesai
 * pada hari berikutnya.
 */
function scheduledPunch(rows, schedule) {
  const start = timeToMinutes(schedule.shiftStart);
  const end = timeToMinutes(schedule.shiftEnd);
  if (start === null) return null;

  if (isOvernightShift(schedule.shiftStart, schedule.shiftEnd)) {
    const shiftEndAbs = end <= start ? end + DAY_MINUTES : end;
    const windowStart = start - 360;
    const windowEnd = shiftEndAbs + 360;
    return summarizePunchRows(
      rows.filter(
        (row) => row.absMinutes >= windowStart && row.absMinutes <= windowEnd,
      ),
      { checkoutNearAbs: shiftEndAbs - config.checkoutNearMin },
    );
  }

  const checkoutNearAbs =
    end === null ? null : end - config.checkoutNearMin;
  return summarizePunchRows(sameDayRows(rows), { checkoutNearAbs });
}

/**
 * Punch untuk hari tanpa jadwal. Punch keluar dari shift malam hari
 * sebelumnya diabaikan karena bukan kehadiran pada hari ini.
 */
function offDayPunch(rows) {
  const today = sameDayRows(rows);
  if (!hasCheckIn(today)) return null;
  return summarizePunchRows(today);
}

/**
 * Ringkasan punch pada satu tanggal: masuk pertama, keluar terakhir, jumlah punch.
 * Dipakai untuk kompatibilitas; buildDay memakai getPunchWindow agar shift
 * malam dapat dipasangkan dengan punch pulang hari berikutnya.
 */
async function getPunches(dateStr) {
  const window = await getPunchWindow(dateStr);
  const punches = new Map();

  for (const [userId, rows] of window) {
    const summary = summarizePunchRows(sameDayRows(rows));
    if (summary) punches.set(userId, summary);
  }

  return punches;
}

async function loadSchedules(dateStr) {
  if (!config.scheduleFromDb) {
    return { schedules: new Map(), available: false };
  }

  try {
    return { schedules: await getSchedules(dateStr), available: true };
  } catch (error) {
    if (!scheduleWarningLogged) {
      console.warn(
        `[schedule] Gagal membaca jadwal dari database (${error.message}). ` +
          'Bot akan memakai baseline historis.',
      );
      scheduleWarningLogged = true;
    }
    return { schedules: new Map(), available: false };
  }
}

/**
 * Menyusun data absensi lengkap untuk satu tanggal.
 *
 * options.employees    : hasil getEmployees() yang bisa dipakai ulang
 * options.baselineRows : hasil getFirstPunches() yang bisa dipakai ulang
 */
async function buildDay(dateStr, options = {}) {
  const [employees, baselineRows] = await Promise.all([
    options.employees ? Promise.resolve(options.employees) : getEmployees(),
    options.baselineRows
      ? Promise.resolve(options.baselineRows)
      : getFirstPunches(addDays(dateStr, -config.baselineDays), dateStr),
  ]);

  const [scheduleState, punchWindow] = await Promise.all([
    loadSchedules(dateStr),
    getPunchWindow(dateStr),
  ]);

  const baseline = buildBaselineMap(baselineRows, dateStr, config.baselineDays);

  const list = employees.map((employee) => {
    const key = String(employee.userId);
    const schedule = scheduleState.schedules.get(key) || null;
    const punchRows = punchWindow.get(key) || [];
    const baselineMinutes = baseline.has(key) ? baseline.get(key) : null;

    let shiftStartMinutes = null;
    let shiftEnd = null;
    let overnight = false;
    let source = null;
    let expected = false;
    let punch = null;

    if (schedule && timeToMinutes(schedule.shiftStart) !== null) {
      shiftStartMinutes = timeToMinutes(schedule.shiftStart);
      shiftEnd = schedule.shiftEnd || null;
      overnight = isOvernightShift(schedule.shiftStart, schedule.shiftEnd);
      source = 'jadwal';
      expected = true;
      punch = scheduledPunch(punchRows, schedule);
    } else if (
      !scheduleState.available &&
      baselineMinutes !== null &&
      baselineMinutes !== undefined
    ) {
      // Fallback lama: jadwal DB tidak tersedia sama sekali.
      shiftStartMinutes = baselineMinutes;
      source = 'estimasi';
      expected = true;
      punch = summarizePunchRows(sameDayRows(punchRows));
    } else {
      // Tidak ada jadwal = libur, kecuali ada punch masuk pada hari itu.
      punch = offDayPunch(punchRows);
    }

    const firstIn = punch ? punch.firstIn : null;
    const lastOut = punch ? punch.lastOut : null;
    const firstInAbs = punch ? punch.firstInAbs : null;
    const deltaMinutes =
      firstInAbs !== null && shiftStartMinutes !== null
        ? firstInAbs - shiftStartMinutes
        : null;
    const isLate =
      expected && deltaMinutes !== null && deltaMinutes > config.lateToleranceMin;
    const hasPunch = Boolean(punch);
    const workedMinutes = punch ? punch.workedMinutes : null;

    let status;
    if (expected) {
      if (!hasPunch) status = 'belum';
      else if (punch.missingIn) status = 'hadir_tanpa_masuk';
      else if (isLate) status = 'terlambat';
      else status = 'hadir';
    } else if (!hasPunch) {
      status = 'libur';
    } else if (isSaturday(dateStr)) {
      status = 'tukar_off';
    } else if (
      workedMinutes !== null &&
      workedMinutes > config.overtimeMinMinutes
    ) {
      status = 'lembur';
    } else {
      status = 'hadir';
    }

    return {
      userId: employee.userId,
      badgeNumber: employee.badgeNumber,
      name: employee.name,
      deptId: employee.deptId,
      deptName: employee.deptName,
      firstIn,
      lastOut,
      punchCount: punch ? punch.punchCount : 0,
      workedMinutes,
      missingIn: Boolean(punch && punch.missingIn),
      shiftStart: shiftStartMinutes === null ? null : minutesToTime(shiftStartMinutes),
      shiftEnd: source === 'jadwal' ? shiftEnd : null,
      overnight,
      source,
      estimated: source === 'estimasi',
      deltaMinutes,
      lateMinutes: isLate ? deltaMinutes : 0,
      isLate,
      expected,
      withoutSchedule: !expected && status !== 'libur',
      status,
    };
  });

  list.sort((a, b) => {
    const byName = a.name.localeCompare(b.name, 'id', { sensitivity: 'base' });
    if (byName !== 0) return byName;
    return a.userId.localeCompare(b.userId, 'id', { numeric: true });
  });

  const present = list.filter((employee) => WORKED_STATUSES.has(employee.status));
  const absent = list.filter((employee) => employee.expected && employee.status === 'belum');
  const late = list.filter((employee) => employee.isLate);
  const expected = list.filter((employee) => employee.expected);
  const libur = list.filter((employee) => employee.status === 'libur');
  const lembur = list.filter((employee) => employee.status === 'lembur');
  const tukarOff = list.filter((employee) => employee.status === 'tukar_off');
  const tanpaMasuk = list.filter(
    (employee) => employee.status === 'hadir_tanpa_masuk',
  );
  const hadirTanpaJadwal = list.filter(
    (employee) => !employee.expected && employee.status === 'hadir',
  );
  const scheduledPresent = list.filter(
    (employee) => employee.expected && employee.status !== 'belum',
  );

  return {
    date: dateStr,
    employees: list,
    present,
    absent,
    late,
    expected,
    libur,
    lembur,
    tukarOff,
    tanpaMasuk,
    hadirTanpaJadwal,
    offDayPresent: [...lembur, ...tukarOff, ...hadirTanpaJadwal],
    stats: {
      total: expected.length,
      hadir: scheduledPresent.length,
      tepatWaktu: list.filter(
        (employee) => employee.expected && employee.status === 'hadir',
      ).length,
      terlambat: late.length,
      tanpaMasuk: tanpaMasuk.length,
      belum: absent.length,
      libur: libur.length,
      lembur: lembur.length,
      tukarOff: tukarOff.length,
      hadirTanpaJadwal: hadirTanpaJadwal.length,
    },
  };
}

/**
 * Ringkasan 7 hari terakhir (termasuk tanggal akhir).
 * Data karyawan dan baseline diambil sekali agar tidak mengulang query besar.
 */
async function getWeekSummary(endDate, options = {}) {
  const dates = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    dates.push(addDays(endDate, -offset));
  }

  const employees = options.employees || await getEmployees();
  const baselineRows = await getFirstPunches(
    addDays(dates[0], -config.baselineDays),
    endDate,
  );

  return Promise.all(
    dates.map((date) => buildDay(date, { employees, baselineRows })),
  );
}

/**
 * Ringkasan absensi satu bulan. Hanya tanggal yang sudah berjalan yang
 * dihitung, sehingga bulan berjalan tidak menampilkan hari mendatang
 * sebagai "belum absen".
 */
async function getMonthSummary(month, options = {}) {
  const today = options.today || todayInTz(config.tz);
  const dates = monthDates(month).filter((date) => date <= today);
  if (!dates.length) return [];

  const employees = options.employees || await getEmployees();
  const baselineRows = options.baselineRows || await getFirstPunches(
    addDays(dates[0], -config.baselineDays),
    addDays(dates[dates.length - 1], 1),
  );

  const days = [];
  for (const date of dates) {
    days.push(await buildDay(date, { employees, baselineRows }));
  }
  return days;
}

function hasCheckout(employee) {
  if (!employee.lastOut) return false;
  return employee.missingIn === true || employee.punchCount > 1;
}

/**
 * Menjumlahkan data harian menjadi ringkasan per karyawan dan per departemen.
 * Kehadiran dihitung per karyawan per hari.
 */
function summarizeMonth(days) {
  const stats = {
    hadir: 0,
    terlambat: 0,
    tanpaMasuk: 0,
    belum: 0,
    total: 0,
    missingOut: 0,
    libur: 0,
    lembur: 0,
    tukarOff: 0,
    hadirTanpaJadwal: 0,
    lemburMinutes: 0,
  };
  const employeeMap = new Map();
  const departmentMap = new Map();

  for (const day of days) {
    stats.hadir += day.stats.hadir;
    stats.terlambat += day.stats.terlambat;
    stats.tanpaMasuk += day.stats.tanpaMasuk || 0;
    stats.belum += day.stats.belum;
    stats.total += day.stats.total;
    stats.libur += day.stats.libur || 0;
    stats.lembur += day.stats.lembur || 0;
    stats.tukarOff += day.stats.tukarOff || 0;
    stats.hadirTanpaJadwal += day.stats.hadirTanpaJadwal || 0;

    for (const employee of day.employees) {
      const key = String(employee.userId);
      const worked = WORKED_STATUSES.has(employee.status);

      if (!employeeMap.has(key)) {
        employeeMap.set(key, {
          userId: employee.userId,
          badgeNumber: employee.badgeNumber,
          name: employee.name,
          deptName: employee.deptName,
          expectedDays: 0,
          presentDays: 0,
          lateDays: 0,
          absentDays: 0,
          missingOutDays: 0,
          missingInDays: 0,
          liburDays: 0,
          lemburDays: 0,
          tukarOffDays: 0,
          lemburMinutes: 0,
          lateMinutes: 0,
          firstIns: [],
          lastOuts: [],
        });
      }

      const row = employeeMap.get(key);
      if (employee.expected) row.expectedDays += 1;
      if (employee.expected && worked) row.presentDays += 1;
      if (employee.status === 'libur') row.liburDays += 1;
      if (employee.status === 'lembur') {
        row.lemburDays += 1;
        row.lemburMinutes += employee.workedMinutes || 0;
        stats.lemburMinutes += employee.workedMinutes || 0;
      }
      if (employee.status === 'tukar_off') row.tukarOffDays += 1;
      if (employee.status === 'hadir_tanpa_masuk') row.missingInDays += 1;

      if (worked) {
        const minutes = timeToMinutes(employee.firstIn);
        if (minutes !== null) row.firstIns.push(minutes);

        const outMinutes = hasCheckout(employee) ? timeToMinutes(employee.lastOut) : null;
        if (outMinutes === null) {
          row.missingOutDays += 1;
          stats.missingOut += 1;
        } else {
          row.lastOuts.push(outMinutes);
        }
      }
      if (employee.isLate) {
        row.lateDays += 1;
        row.lateMinutes += employee.lateMinutes;
      }
      if (employee.expected && employee.status === 'belum') row.absentDays += 1;

      const deptKey = employee.deptName || 'Tanpa Departemen';
      if (!departmentMap.has(deptKey)) {
        departmentMap.set(deptKey, {
          name: deptKey,
          userIds: new Set(),
          expected: 0,
          present: 0,
          late: 0,
          absent: 0,
          missingOut: 0,
          missingIn: 0,
          libur: 0,
          lembur: 0,
          tukarOff: 0,
        });
      }

      const dept = departmentMap.get(deptKey);
      dept.userIds.add(key);
      if (employee.expected) dept.expected += 1;
      if (employee.expected && worked) dept.present += 1;
      if (employee.isLate) dept.late += 1;
      if (employee.expected && employee.status === 'belum') dept.absent += 1;
      if (employee.status === 'libur') dept.libur += 1;
      if (employee.status === 'lembur') dept.lembur += 1;
      if (employee.status === 'tukar_off') dept.tukarOff += 1;
      if (employee.status === 'hadir_tanpa_masuk') dept.missingIn += 1;
      if (worked && !hasCheckout(employee)) dept.missingOut += 1;
    }
  }

  const employees = [...employeeMap.values()]
    .map((row) => ({
      ...row,
      averageFirstIn: row.firstIns.length
        ? Math.round(row.firstIns.reduce((sum, value) => sum + value, 0) / row.firstIns.length)
        : null,
      averageLastOut: row.lastOuts.length
        ? Math.round(row.lastOuts.reduce((sum, value) => sum + value, 0) / row.lastOuts.length)
        : null,
    }))
    .sort((a, b) => {
      const byLabel = a.name.localeCompare(b.name, 'id', { sensitivity: 'base' });
      if (byLabel !== 0) return byLabel;
      return a.userId.localeCompare(b.userId, 'id', { numeric: true });
    });

  const departments = [...departmentMap.values()]
    .map((dept) => ({ ...dept, employeeCount: dept.userIds.size }))
    .sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));

  return { stats, employees, departments };
}

function findEmployees(day, term) {
  const needle = normalizeText(term);
  if (!needle) return [];

  const exact = day.employees.filter((employee) => {
    return (
      normalizeText(employee.userId) === needle ||
      (employee.badgeNumber && normalizeText(employee.badgeNumber) === needle)
    );
  });
  if (exact.length) return exact;

  return day.employees.filter((employee) => normalizeText(employee.name).includes(needle));
}

module.exports = {
  WORKED_STATUSES,
  isOvernightShift,
  getEmployees,
  getSchedules,
  getFirstPunches,
  buildBaselineMap,
  getPunchWindow,
  summarizePunchRows,
  getPunches,
  buildDay,
  getWeekSummary,
  getMonthSummary,
  summarizeMonth,
  findEmployees,
  median,
  normalizeText,
};
