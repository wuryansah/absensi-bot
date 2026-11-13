'use strict';

const config = require('./config');
const { summarizeMonth } = require('./schedule');
const {
  formatDateLong,
  formatDateShort,
  formatDateShortWithDay,
  formatMonthLong,
  minutesToTime,
  timeToMinutes,
  todayInTz,
} = require('./dates');

const WORKED_STATUSES = new Set([
  'hadir',
  'hadir_tanpa_masuk',
  'terlambat',
  'lembur',
  'tukar_off',
]);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function byName(a, b) {
  const byLabel = a.name.localeCompare(b.name, 'id', { sensitivity: 'base' });
  if (byLabel !== 0) return byLabel;
  return a.userId.localeCompare(b.userId, 'id', { numeric: true });
}

function byLateness(a, b) {
  return (
    b.lateMinutes - a.lateMinutes ||
    String(a.firstIn || '99:99').localeCompare(String(b.firstIn || '99:99')) ||
    byName(a, b)
  );
}

function identity(employee, options = {}) {
  const showDepartment = options.showDepartment !== false;
  const dept = showDepartment && employee.deptName
    ? ` — ${escapeHtml(employee.deptName)}`
    : '';
  return `<b>${escapeHtml(employee.name)}</b>${dept}`;
}

function departmentGroups(employees) {
  const groups = new Map();
  for (const employee of employees) {
    const name = employee.deptName || 'Tanpa Departemen';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(employee);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'id', { sensitivity: 'base' }))
    .map(([name, list]) => [name, [...list].sort(byName)]);
}

function appendDepartmentGroups(lines, employees, renderLine) {
  let index = 0;
  let first = true;
  for (const [name, list] of departmentGroups(employees)) {
    if (!first) lines.push('');
    first = false;
    lines.push(`<b>🏢 ${escapeHtml(name)} (${list.length})</b>`);
    for (const employee of list) {
      index += 1;
      lines.push(renderLine(employee, index, { showDepartment: false }));
    }
  }
  return index;
}

function estimatedSuffix(employee) {
  return employee.estimated ? ' · <i>estimasi</i>' : '';
}

function estimatedFooter(list) {
  const count = list.filter((employee) => employee.estimated).length;
  if (!count) return '';
  return `<i>* = jam masuk estimasi dari median ${config.baselineDays} hari (${count} baris).</i>`;
}

function shiftText(employee) {
  if (!employee.shiftStart) return 'shift tidak tersedia';
  const range = employee.shiftEnd
    ? `${employee.shiftStart}–${employee.shiftEnd}`
    : employee.shiftStart;
  return `shift ${range}${employee.overnight ? ' (lintas hari)' : ''}`;
}

function durationText(minutes) {
  if (!Number.isFinite(minutes)) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours}j ${rest}m`;
  if (hours) return `${hours}j`;
  return `${rest}m`;
}

function lateLine(employee, index, options = {}) {
  const details = [];
  if (employee.firstIn) details.push(`masuk ${employee.firstIn}`);
  if (employee.punchCount > 1 && employee.lastOut) details.push(`pulang ${employee.lastOut}`);
  if (employee.shiftStart) details.push(shiftText(employee));
  if (employee.lateMinutes) details.push(`+${employee.lateMinutes} mnt`);

  const prefix = employee.estimated ? '* ' : '';
  const detail = details.length ? ` · ${details.join(' · ')}` : '';
  return `${prefix}${index}. ${identity(employee, options)}${detail}${estimatedSuffix(employee)}`;
}

function hasCheckout(employee) {
  return Boolean(employee.lastOut) && (employee.punchCount > 1 || employee.missingIn);
}

function presentLine(employee, index, options = {}) {
  const details = [];
  const hasOut = hasCheckout(employee);
  if (employee.firstIn) details.push(`masuk ${employee.firstIn}`);
  if (hasOut) details.push(`pulang ${employee.lastOut}`);
  if (employee.missingIn) details.push('⚠️ tanpa absen masuk');
  if (!hasOut) details.push('🚪 tanpa absen pulang');
  if (employee.shiftStart) details.push(shiftText(employee));
  else if (employee.withoutSchedule) details.push('tanpa jadwal');
  if (employee.isLate) details.push(`⏰ +${employee.lateMinutes} mnt`);
  if (employee.status === 'lembur' && employee.workedMinutes !== null) {
    details.push(`lembur ${durationText(employee.workedMinutes)}`);
  }

  const prefix = employee.estimated ? '* ' : '';
  const detail = details.length ? ` · ${details.join(' · ')}` : '';
  return `${prefix}${index}. ${identity(employee, options)}${detail}${estimatedSuffix(employee)}`;
}

function absentLine(employee, index, options = {}) {
  const shift = shiftText(employee);
  const prefix = employee.estimated ? '* ' : '';
  return `${prefix}${index}. ${identity(employee, options)} · ${shift}${estimatedSuffix(employee)}`;
}

function offDayLine(employee, index) {
  const details = [];
  if (employee.firstIn) details.push(`masuk ${employee.firstIn}`);
  if (employee.punchCount > 1 && employee.lastOut) details.push(`pulang ${employee.lastOut}`);
  if (employee.workedMinutes !== null) details.push(durationText(employee.workedMinutes));

  const label = employee.status === 'tukar_off'
    ? '🔄 Tukar off'
    : employee.status === 'lembur'
      ? '🕒 Lembur'
      : '✅ Tanpa jadwal';
  return `${index}. ${identity(employee)} · ${label} · ${details.join(' · ')}`;
}

function summaryLines(stats) {
  const lateNote = stats.terlambat > 0 && stats.hadir > 0
    ? ` (dari ${stats.hadir} yang hadir)`
    : '';

  const lines = [
    `✅ Hadir: <b>${stats.hadir}</b>`,
    `⏰ Terlambat: <b>${stats.terlambat}</b>${lateNote}`,
  ];
  if (stats.tanpaMasuk) {
    lines.push(`⚠️ Hadir tanpa absen masuk: <b>${stats.tanpaMasuk}</b>`);
  }

  if (stats.lembur) lines.push(`🕒 Lembur: <b>${stats.lembur}</b>`);
  if (stats.tukarOff) lines.push(`🔄 Tukar off: <b>${stats.tukarOff}</b>`);
  if (stats.hadirTanpaJadwal) {
    lines.push(`✅ Tanpa jadwal: <b>${stats.hadirTanpaJadwal}</b>`);
  }
  if (stats.libur) lines.push(`🛌 Libur: <b>${stats.libur}</b>`);

  lines.push(`❌ Belum absen: <b>${stats.belum}</b>`);
  lines.push(`👥 Total: <b>${stats.total}</b>`);
  return lines;
}

function todayReport(day) {
  const lines = [
    '<b>📊 Absensi Hari Ini</b>',
    `<b>${formatDateLong(day.date)}</b>`,
    '',
  ];

  const offDayPresent = day.offDayPresent || [];

  if (day.stats.total === 0 && !offDayPresent.length && !day.stats.libur) {
    lines.push('Tidak ada karyawan yang dijadwalkan atau memiliki riwayat absensi pada hari ini.');
    return lines.join('\n');
  }

  lines.push(...summaryLines(day.stats));
  lines.push('');

  if (day.late.length) {
    const late = [...day.late].sort(byLateness);
    lines.push(`<b>⏰ Terlambat (${late.length})</b>`);
    late.slice(0, 5).forEach((employee, index) => {
      lines.push(lateLine(employee, index + 1));
    });
    if (late.length > 5) {
      lines.push(`<i>… dan ${late.length - 5} lainnya. Lihat /terlambat.</i>`);
    }
    lines.push('');
  } else {
    lines.push('Tidak ada karyawan terlambat. 👍');
    lines.push('');
  }

  if (offDayPresent.length) {
    const sorted = [...offDayPresent].sort(byName);
    lines.push(`<b>🕒 Masuk di hari libur (${sorted.length})</b>`);
    sorted.slice(0, 5).forEach((employee, index) => {
      lines.push(offDayLine(employee, index + 1));
    });
    if (sorted.length > 5) {
      lines.push(`<i>… dan ${sorted.length - 5} lainnya.</i>`);
    }
    lines.push('');
  }

  if (day.absent.length) {
    const absent = [...day.absent].sort(byName);
    lines.push(`<b>❌ Belum absen (${absent.length})</b>`);
    absent.slice(0, 5).forEach((employee, index) => {
      lines.push(absentLine(employee, index + 1));
    });
    if (absent.length > 5) {
      lines.push(`<i>… dan ${absent.length - 5} lainnya. Lihat /absen.</i>`);
    }
    lines.push('');
  } else {
    lines.push('Semua karyawan yang dijadwalkan sudah absen. 🎉');
  }

  const displayed = [
    ...[...day.late].sort(byLateness).slice(0, 5),
    ...[...day.absent].sort(byName).slice(0, 5),
  ];
  const footer = estimatedFooter(displayed);
  if (footer) lines.push('', footer);

  return lines.join('\n').trim();
}

function lateReport(day) {
  const lines = [
    '<b>⏰ Karyawan Terlambat</b>',
    `<b>${formatDateLong(day.date)}</b>`,
    '',
  ];

  if (!day.late.length) {
    lines.push('Tidak ada karyawan terlambat. 👍');
    return lines.join('\n');
  }

  const late = [...day.late];
  lines.push(`${late.length} karyawan terlambat (toleransi ${config.lateToleranceMin} menit):`);
  lines.push('');
  appendDepartmentGroups(lines, late, lateLine);

  const footer = estimatedFooter(late);
  if (footer) lines.push('', footer);

  return lines.join('\n');
}

function absentReport(day) {
  const lines = [
    '<b>❌ Belum Absen</b>',
    `<b>${formatDateLong(day.date)}</b>`,
    '',
  ];

  if (!day.absent.length) {
    lines.push('Semua karyawan yang dijadwalkan sudah absen. 🎉');
    return lines.join('\n');
  }

  const absent = [...day.absent];
  lines.push(`${absent.length} karyawan belum absen:`);
  lines.push('');
  appendDepartmentGroups(lines, absent, absentLine);

  const footer = estimatedFooter(absent);
  if (footer) lines.push('', footer);

  return lines.join('\n');
}

function offReport(day) {
  const lines = [
    '<b>🛌 Karyawan Libur</b>',
    `<b>${formatDateLong(day.date)}</b>`,
    '',
  ];

  const off = [...(day.libur || [])];

  if (!off.length) {
    lines.push('Tidak ada karyawan yang libur pada tanggal ini.');
    return lines.join('\n');
  }

  lines.push(`${off.length} karyawan libur (tidak ada jadwal shift):`);
  lines.push('');

  const rendered = [];
  let number = 0;
  for (const [name, list] of departmentGroups(off)) {
    rendered.push({ text: `<b>🏢 ${escapeHtml(name)} (${list.length})</b>`, employee: false });
    for (const employee of list) {
      number += 1;
      rendered.push({
        text: `${number}. <b>${escapeHtml(employee.name)}</b>`,
        employee: true,
      });
    }
  }

  const maxLength = 3800;
  let length = lines.join('\n').length + 1;
  let shown = 0;
  for (const item of rendered) {
    if (length + item.text.length + 1 > maxLength) break;
    lines.push(item.text);
    length += item.text.length + 1;
    if (item.employee) shown += 1;
  }
  if (shown < off.length) {
    lines.push('');
    lines.push(`<i>… dan ${off.length - shown} lainnya.</i>`);
  }

  const came = (day.offDayPresent || []).length;
  if (came) {
    lines.push('');
    lines.push(`<i>${came} karyawan lain masuk pada hari libur. Lihat /today.</i>`);
  }

  return lines.join('\n');
}

function presentReport(day) {
  const lines = [
    '<b>✅ Sudah Absen</b>',
    `<b>${formatDateLong(day.date)}</b>`,
    '',
  ];

  if (!day.present.length) {
    lines.push('Belum ada karyawan yang absen pada tanggal ini.');
    return lines.join('\n');
  }

  const present = [...day.present];
  lines.push(`${present.length} karyawan sudah absen:`);
  lines.push('');
  appendDepartmentGroups(lines, present, presentLine);

  const footers = [];
  const estimated = estimatedFooter(present);
  if (estimated) footers.push(estimated);
  if (present.some((employee) => employee.isLate)) {
    footers.push(`<i>⏰ = melewati toleransi ${config.lateToleranceMin} menit.</i>`);
  }
  if (present.some((employee) => employee.missingIn)) {
    footers.push('<i>⚠️ = hadir tanpa absen masuk.</i>');
  }
  if (present.some((employee) => !hasCheckout(employee))) {
    footers.push('<i>🚪 = hadir tanpa absen pulang.</i>');
  }
  if (footers.length) lines.push('', ...footers);

  return lines.join('\n');
}

function employeeReport(day, employee) {
  const lines = [
    `<b>👤 ${escapeHtml(employee.name)}</b>`,
    `ID: <code>${escapeHtml(employee.userId)}</code>` +
      (employee.badgeNumber ? ` · NIP: <code>${escapeHtml(employee.badgeNumber)}</code>` : '') +
      ` · Dept: ${escapeHtml(employee.deptName)}`,
    '',
    `📅 <b>${formatDateLong(day.date)}</b>`,
  ];

  let status;
  if (employee.status === 'libur') {
    status = '🛌 <b>Libur</b> (tidak ada jadwal)';
  } else if (employee.status === 'tukar_off') {
    status = '🔄 <b>Tukar off</b>';
  } else if (employee.status === 'lembur') {
    status = '🕒 <b>Lembur</b>';
  } else if (employee.status === 'terlambat') {
    status = '⏰ <b>Terlambat</b>';
  } else if (employee.status === 'hadir_tanpa_masuk') {
    status = '⚠️ <b>Hadir tanpa absen masuk</b>';
  } else if (employee.status === 'hadir') {
    status = employee.shiftStart ? '✅ <b>Hadir</b>' : '✅ <b>Hadir</b> (tanpa jadwal)';
  } else {
    status = '❌ <b>Belum absen</b>';
  }
  lines.push(`Status: ${status}`);

  if (employee.firstIn) {
    lines.push(`Masuk: <b>${employee.firstIn}</b>`);
  } else if (employee.missingIn) {
    lines.push('Masuk: <b>tidak ada</b>');
  }
  if (employee.lastOut && (employee.punchCount > 1 || employee.missingIn)) {
    lines.push(`Pulang: ${employee.lastOut}`);
  } else if (employee.punchCount === 1) {
    lines.push('Pulang: belum ada punch keluar');
  }

  if (employee.shiftStart) {
    const shift = employee.shiftEnd
      ? `${employee.shiftStart}–${employee.shiftEnd}`
      : employee.shiftStart;
    const source = employee.estimated
      ? `estimasi median ${config.baselineDays} hari`
      : 'jadwal';
    const overnight = employee.overnight ? ', lintas hari' : '';
    lines.push(`Shift: ${shift} (${source}${overnight})`);
  } else if (employee.status === 'libur') {
    lines.push('Shift: tidak ada jadwal (libur)');
  } else {
    lines.push('Shift: tidak tersedia (tanpa jadwal)');
  }

  if (employee.workedMinutes !== null) {
    lines.push(`Durasi kerja: <b>${durationText(employee.workedMinutes)}</b>`);
  }

  if (employee.isLate) {
    lines.push(`Keterlambatan: <b>${employee.lateMinutes} menit</b>`);
  } else if (
    employee.deltaMinutes !== null &&
    employee.deltaMinutes > 0 &&
    employee.shiftStart
  ) {
    lines.push(
      `Selisih dari shift: +${employee.deltaMinutes} menit ` +
        `(masih dalam toleransi ${config.lateToleranceMin} menit)`,
    );
  }

  if (employee.punchCount > 1 || employee.missingIn) {
    lines.push(`Jumlah punch: ${employee.punchCount}`);
  }

  if (employee.status === 'tukar_off') {
    lines.push('');
    lines.push('<i>Masuk pada hari Sabtu tanpa jadwal; dihitung sebagai tukar off.</i>');
  } else if (employee.status === 'lembur') {
    lines.push('');
    lines.push(
      `<i>Masuk tanpa jadwal lebih dari ${config.overtimeMinMinutes} menit; ` +
        'dihitung sebagai lembur.</i>',
    );
  } else if (employee.missingIn) {
    lines.push('');
    lines.push(
      `<i>Punch hanya ada dalam ${config.checkoutNearMin} menit sebelum jam pulang; ` +
        'dianggap absen pulang, bukan absen masuk.</i>',
    );
  } else if (employee.status === 'hadir' && !employee.expected) {
    lines.push('');
    lines.push('<i>Masuk tanpa jadwal; belum melewati batas lembur.</i>');
  }

  return lines.join('\n');
}

function searchResultsReport(day, matches, term) {
  const lines = [
    `<b>🔎 Hasil pencarian "${escapeHtml(term)}"</b>`,
    `<b>${formatDateLong(day.date)}</b>`,
    '',
    `Ditemukan ${matches.length} karyawan:`,
  ];

  matches.slice(0, 10).forEach((employee, index) => {
    lines.push(
      `${index + 1}. ${identity(employee)} · ID <code>${escapeHtml(employee.userId)}</code>`,
    );
  });
  if (matches.length > 10) {
    lines.push(`<i>… dan ${matches.length - 10} lainnya.</i>`);
  }

  lines.push('');
  lines.push('Gunakan <code>/cek &lt;id&gt;</code> untuk melihat detail.');
  return lines.join('\n');
}

function departmentReport(day) {
  const lines = [
    '<b>🏢 Rekap per Departemen</b>',
    `<b>${formatDateLong(day.date)}</b>`,
    '',
  ];

  if (!day.expected.length) {
    lines.push('Tidak ada karyawan yang dijadwalkan pada tanggal ini.');
    return lines.join('\n');
  }

  const groups = new Map();
  for (const employee of day.expected) {
    const key = employee.deptName || 'Tanpa Departemen';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(employee);
  }

  const sorted = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'id', { sensitivity: 'base' }));

  for (const [deptName, employees] of sorted) {
    const total = employees.length;
    const hadir = employees.filter((employee) => employee.status !== 'belum').length;
    const terlambat = employees.filter((employee) => employee.isLate).length;
    const tepatWaktu = employees.filter((employee) => employee.status === 'hadir').length;
    const tanpaMasuk = employees.filter(
      (employee) => employee.status === 'hadir_tanpa_masuk',
    ).length;
    const belum = total - hadir;

    let detail = `✅ ${hadir} hadir`;
    if (terlambat > 0) detail += ` (${tepatWaktu} tepat waktu, ${terlambat} terlambat)`;
    if (tanpaMasuk > 0) detail += ` · ⚠️ ${tanpaMasuk} tanpa masuk`;
    detail += ` · ❌ ${belum} belum`;

    lines.push(`• <b>${escapeHtml(deptName)}</b> — ${total} karyawan`);
    lines.push(`  ${detail}`);
  }

  lines.push('');
  lines.push('<b>Total keseluruhan</b>');
  lines.push(...summaryLines(day.stats));

  return lines.join('\n');
}

function weekReport(days) {
  const first = days[0];
  const last = days[days.length - 1];
  const today = todayInTz(config.tz);

  const lines = [
    '<b>📅 Ringkasan 7 Hari Terakhir</b>',
    `<b>${formatDateShort(first.date)} – ${formatDateShort(last.date)}</b>`,
    '',
  ];

  for (const day of days) {
    const marker = day.date === today ? ' <i>(hari ini)</i>' : '';
    const tanpaMasuk = day.stats.tanpaMasuk
      ? ` · ⚠️ ${day.stats.tanpaMasuk}`
      : '';
    lines.push(
      `• <b>${formatDateShortWithDay(day.date)}</b>${marker} — ` +
        `✅ ${day.stats.hadir} · ⏰ ${day.stats.terlambat}${tanpaMasuk} · ❌ ${day.stats.belum}`,
    );
  }

  const totals = days.reduce(
    (accumulator, day) => {
      accumulator.hadir += day.stats.hadir;
      accumulator.terlambat += day.stats.terlambat;
      accumulator.tanpaMasuk += day.stats.tanpaMasuk || 0;
      accumulator.belum += day.stats.belum;
      accumulator.total += day.stats.total;
      return accumulator;
    },
    { hadir: 0, terlambat: 0, tanpaMasuk: 0, belum: 0, total: 0 },
  );

  lines.push('');
  lines.push('<b>Total 7 hari</b>');
  lines.push(
    `✅ ${totals.hadir} hadir · ⏰ ${totals.terlambat} terlambat · ❌ ${totals.belum} belum`,
  );
  if (totals.tanpaMasuk) {
    lines.push(`⚠️ ${totals.tanpaMasuk} hadir tanpa absen masuk`);
  }
  lines.push(`Rata-rata: ${Math.round(totals.hadir / days.length)} hadir/hari`);
  lines.push('');
  lines.push('<i>Hadir termasuk karyawan yang terlambat.</i>');

  return lines.join('\n');
}

function monthRangeLabel(days) {
  if (!days.length) return '';
  const first = days[0].date;
  const last = days[days.length - 1].date;
  return first === last
    ? formatDateShort(first)
    : `${formatDateShort(first)} – ${formatDateShort(last)}`;
}

function monthTitle(month) {
  const current = todayInTz(config.tz).slice(0, 7);
  const suffix = month === current ? ' <i>(bulan berjalan)</i>' : '';
  return `<b>${formatMonthLong(month)}</b>${suffix}`;
}

function monthReport(month, days) {
  const lines = [
    '<b>🗓️ Rekap Absensi Bulanan</b>',
    monthTitle(month),
    '',
  ];

  if (!days.length) {
    lines.push('Belum ada data absensi pada bulan ini.');
    return lines.join('\n');
  }

  lines.push(`<i>${monthRangeLabel(days)} · ${days.length} hari</i>`);
  lines.push('');

  const { stats, employees, departments } = summarizeMonth(days);
  const tepatWaktu = Math.max(
    stats.hadir - stats.terlambat - stats.tanpaMasuk,
    0,
  );

  lines.push('<b>📊 Ringkasan</b>');
  lines.push(
    `• Kehadiran: <b>${stats.hadir}</b> ` +
      `(${tepatWaktu} tepat waktu · ${stats.terlambat} terlambat)`,
  );
  lines.push(`• Belum absen: <b>${stats.belum}</b>`);
  if (stats.tanpaMasuk) {
    lines.push(`• Hadir tanpa absen masuk: <b>${stats.tanpaMasuk}</b> hari`);
  }
  lines.push(`• Tanpa absen pulang: <b>${stats.missingOut}</b>`);
  if (stats.libur) lines.push(`• Libur: <b>${stats.libur}</b>`);
  if (stats.lembur) {
    lines.push(
      `• Lembur: <b>${stats.lembur}</b> hari` +
        (stats.lemburMinutes ? ` · total ${durationText(stats.lemburMinutes)}` : ''),
    );
  }
  if (stats.tukarOff) lines.push(`• Tukar off: <b>${stats.tukarOff}</b> hari`);
  if (stats.hadirTanpaJadwal) {
    lines.push(`• Masuk tanpa jadwal: <b>${stats.hadirTanpaJadwal}</b> hari`);
  }
  lines.push(`• Karyawan: <b>${employees.length}</b>`);
  lines.push(`• Rata-rata hadir: <b>${Math.round(stats.hadir / days.length)}</b>/hari`);
  lines.push('');

  if (departments.length) {
    lines.push('<b>🏢 Per Departemen</b>');
    for (const dept of departments) {
      const noOut = dept.missingOut > 0 ? ` · 🚪 ${dept.missingOut}` : '';
      const noIn = dept.missingIn > 0 ? ` · ⚠️ ${dept.missingIn}` : '';
      const offDay = dept.lembur || dept.tukarOff
        ? ` · 🕒 ${dept.lembur} · 🔄 ${dept.tukarOff}`
        : '';
      lines.push(
        `• <b>${escapeHtml(dept.name)}</b> — ${dept.employeeCount} karyawan · ` +
          `✅ ${dept.present} · ⏰ ${dept.late} · ❌ ${dept.absent}${offDay}${noIn}${noOut}`,
      );
    }
    lines.push('');
  }

  const late = employees
    .filter((employee) => employee.lateDays > 0)
    .sort(
      (a, b) =>
        b.lateMinutes - a.lateMinutes ||
        b.lateDays - a.lateDays ||
        byName(a, b),
    );

  if (late.length) {
    lines.push('<b>⏰ Paling Sering Terlambat</b>');
    late.slice(0, 10).forEach((employee, index) => {
      lines.push(
        `${index + 1}. <b>${escapeHtml(employee.name)}</b> — ` +
          `${escapeHtml(employee.deptName)} · ${employee.lateDays} hari · ` +
          `total ${employee.lateMinutes} mnt`,
      );
    });
    if (late.length > 10) {
      lines.push(`<i>… dan ${late.length - 10} lainnya.</i>`);
    }
    lines.push('');
  }

  const absent = employees
    .filter((employee) => employee.absentDays > 0)
    .sort((a, b) => b.absentDays - a.absentDays || byName(a, b));

  if (absent.length) {
    lines.push('<b>❌ Paling Sering Tidak Absen</b>');
    absent.slice(0, 5).forEach((employee, index) => {
      lines.push(
        `${index + 1}. <b>${escapeHtml(employee.name)}</b> — ` +
          `${escapeHtml(employee.deptName)} · ${employee.absentDays} hari`,
      );
    });
    if (absent.length > 5) {
      lines.push(`<i>… dan ${absent.length - 5} lainnya.</i>`);
    }
    lines.push('');
  }

  const noOut = employees
    .filter((employee) => employee.missingOutDays > 0)
    .sort((a, b) => b.missingOutDays - a.missingOutDays || byName(a, b));

  if (noOut.length) {
    lines.push('<b>🚪 Paling Sering Tanpa Absen Pulang</b>');
    noOut.slice(0, 5).forEach((employee, index) => {
      lines.push(
        `${index + 1}. <b>${escapeHtml(employee.name)}</b> — ` +
          `${escapeHtml(employee.deptName)} · ${employee.missingOutDays} hari`,
      );
    });
    if (noOut.length > 5) {
      lines.push(`<i>… dan ${noOut.length - 5} lainnya.</i>`);
    }
    lines.push('');
  }

  const noIn = employees
    .filter((employee) => employee.missingInDays > 0)
    .sort((a, b) => b.missingInDays - a.missingInDays || byName(a, b));

  if (noIn.length) {
    lines.push('<b>⚠️ Paling Sering Tanpa Absen Masuk</b>');
    noIn.slice(0, 5).forEach((employee, index) => {
      lines.push(
        `${index + 1}. <b>${escapeHtml(employee.name)}</b> — ` +
          `${escapeHtml(employee.deptName)} · ${employee.missingInDays} hari`,
      );
    });
    if (noIn.length > 5) {
      lines.push(`<i>… dan ${noIn.length - 5} lainnya.</i>`);
    }
    lines.push('');
  }

  lines.push(
    '<i>Kehadiran dihitung per karyawan per hari. ⏰ termasuk hadir. ' +
      '🚪 = hadir tanpa punch pulang. ⚠️ = hadir tanpa absen masuk.</i>',
  );
  return lines.join('\n');
}

function employeeMonthReport(month, days, employee) {
  const lines = [
    `<b>👤 ${escapeHtml(employee.name)}</b>`,
    `ID: <code>${escapeHtml(employee.userId)}</code>` +
      (employee.badgeNumber ? ` · NIP: <code>${escapeHtml(employee.badgeNumber)}</code>` : '') +
      ` · Dept: ${escapeHtml(employee.deptName)}`,
    '',
    `🗓️ <b>${formatMonthLong(month)}</b> · <i>${monthRangeLabel(days)}</i>`,
    '',
  ];

  const rows = days
    .map((day) => ({
      date: day.date,
      employee: day.employees.find((item) => item.userId === employee.userId),
    }))
    .filter((row) => row.employee && (row.employee.expected || row.employee.status !== 'belum'));

  let presentDays = 0;
  let lateDays = 0;
  let absentDays = 0;
  let missingOutDays = 0;
  let missingInDays = 0;
  let lateMinutes = 0;
  const firstIns = [];
  const lastOuts = [];

  let offDayWorkDays = 0;
  let liburDays = 0;

  for (const row of rows) {
    const item = row.employee;
    if (WORKED_STATUSES.has(item.status)) {
      presentDays += 1;
      if (!item.expected) offDayWorkDays += 1;

      const minutes = timeToMinutes(item.firstIn);
      if (minutes !== null) firstIns.push(minutes);

      const outMinutes =
        item.lastOut && (item.punchCount > 1 || item.missingIn)
          ? timeToMinutes(item.lastOut)
          : null;
      if (outMinutes === null) {
        missingOutDays += 1;
      } else {
        lastOuts.push(outMinutes);
      }
    }
    if (item.status === 'libur') liburDays += 1;
    if (item.status === 'hadir_tanpa_masuk') missingInDays += 1;
    if (item.isLate) {
      lateDays += 1;
      lateMinutes += item.lateMinutes;
    }
    if (item.expected && item.status === 'belum') absentDays += 1;
  }

  lines.push('<b>📊 Ringkasan</b>');
  lines.push(
    `• Hadir: <b>${presentDays}</b> hari ` +
      `(${presentDays - lateDays - missingInDays - offDayWorkDays} tepat waktu · ${lateDays} terlambat)`,
  );
  if (offDayWorkDays) {
    lines.push(`• Masuk di hari libur: <b>${offDayWorkDays}</b> hari`);
  }
  if (liburDays) lines.push(`• Libur: <b>${liburDays}</b> hari`);
  lines.push(`• Belum absen: <b>${absentDays}</b> hari`);
  lines.push(`• Tanpa absen masuk: <b>${missingInDays}</b> hari`);
  lines.push(`• Tanpa absen pulang: <b>${missingOutDays}</b> hari`);
  if (lateMinutes > 0) {
    lines.push(`• Total keterlambatan: <b>${lateMinutes} menit</b>`);
  }
  if (firstIns.length) {
    const average = Math.round(firstIns.reduce((sum, value) => sum + value, 0) / firstIns.length);
    lines.push(`• Rata-rata masuk: <b>${minutesToTime(average)}</b>`);
  }
  if (lastOuts.length) {
    const average = Math.round(lastOuts.reduce((sum, value) => sum + value, 0) / lastOuts.length);
    lines.push(`• Rata-rata pulang: <b>${minutesToTime(average)}</b>`);
  }
  lines.push('');

  if (!rows.length) {
    lines.push('Tidak ada jadwal atau data absensi pada bulan ini.');
    return lines.join('\n');
  }

  lines.push('<b>📅 Rincian Harian</b>');
  for (const row of rows) {
    const item = row.employee;
    const label = formatDateShortWithDay(row.date);
    const checkout = item.lastOut && (item.punchCount > 1 || item.missingIn)
      ? ` · pulang ${item.lastOut}`
      : ' · pulang belum ada';

    if (item.status === 'terlambat') {
      lines.push(
        `• ${label} — ⏰ masuk ${item.firstIn} (+${item.lateMinutes} mnt)${checkout}`,
      );
    } else if (item.status === 'hadir_tanpa_masuk') {
      lines.push(`• ${label} — ⚠️ tanpa absen masuk${checkout}`);
    } else if (item.status === 'hadir') {
      const note = item.shiftStart ? '' : ' (tanpa jadwal)';
      lines.push(`• ${label} — ✅ masuk ${item.firstIn}${note}${checkout}`);
    } else if (item.status === 'libur') {
      lines.push(`• ${label} — 🛌 libur`);
    } else if (item.status === 'lembur' || item.status === 'tukar_off') {
      const tag = item.status === 'lembur' ? '🕒 lembur' : '🔄 tukar off';
      const inText = item.firstIn ? ` · masuk ${item.firstIn}` : '';
      lines.push(`• ${label} — ${tag}${inText}${checkout}`);
    } else {
      lines.push(`• ${label} — ❌ belum absen`);
    }
  }

  return lines.join('\n');
}

function monthSearchResultsReport(month, matches, term) {
  const lines = [
    `<b>🔎 Hasil pencarian "${escapeHtml(term)}"</b>`,
    `<b>${formatMonthLong(month)}</b>`,
    '',
    `Ditemukan ${matches.length} karyawan:`,
  ];

  matches.slice(0, 10).forEach((employee, index) => {
    lines.push(
      `${index + 1}. ${identity(employee)} · ID <code>${escapeHtml(employee.userId)}</code>`,
    );
  });
  if (matches.length > 10) {
    lines.push(`<i>… dan ${matches.length - 10} lainnya.</i>`);
  }

  lines.push('');
  lines.push('Gunakan <code>/bulan &lt;id&gt;</code> untuk melihat detail.');
  return lines.join('\n');
}

function helpText() {
  return [
    '<b>🤖 Bot Absensi Karyawan</b>',
    '',
    '<b>Perintah</b>',
    '/menu — tampilkan menu tombol',
    '/today — ringkasan absensi hari ini',
    '/terlambat [tanggal] — daftar karyawan terlambat',
    '/absen [tanggal] — daftar karyawan belum absen',
    '/off [tanggal] — daftar karyawan libur',
    '/hadir [tanggal] — daftar yang sudah absen, per departemen urut nama',
    '/masuk [tanggal] — sama dengan /hadir',
    '/cek &lt;nama|id&gt; [tanggal] — status satu karyawan',
    '/rekap [tanggal] — rekap per departemen',
    '/minggu — ringkasan 7 hari terakhir',
    '/bulan [bulan] — rekap absensi bulan berjalan',
    '/bulan &lt;nama|id&gt; [bulan] — rekap satu karyawan dalam sebulan',
    '/id — chat id untuk mengisi ALLOWED_CHATS',
    '',
    'Format tanggal: <code>2026-11-02</code> atau <code>02-11-2026</code>.',
    'Format bulan: <code>2026-11</code> atau <code>11-2026</code>.',
    `Tanpa argumen berarti hari ini / bulan berjalan (${escapeHtml(config.tz)}).`,
  ].join('\n');
}

const MENU_ROWS = [
  [
    { text: '📊 Hari ini', callback_data: 'cmd:today' },
    { text: '⏰ Terlambat', callback_data: 'cmd:terlambat' },
  ],
  [
    { text: '✅ Hadir', callback_data: 'cmd:hadir' },
    { text: '🚫 Belum absen', callback_data: 'cmd:absen' },
    { text: '🛌 Libur', callback_data: 'cmd:off' },
  ],
  [
    { text: '🏢 Rekap dept', callback_data: 'cmd:rekap' },
    { text: '📅 7 hari', callback_data: 'cmd:minggu' },
  ],
  [
    { text: '🗓️ Bulan ini', callback_data: 'cmd:bulan' },
    { text: '🔍 Cek karyawan', callback_data: 'cmd:cek' },
    { text: '🆔 Chat ID', callback_data: 'cmd:id' },
  ],
];

function menuText() {
  return [
    '<b>📋 Menu Bot Absensi</b>',
    '',
    'Pilih laporan yang ingin ditampilkan:',
    '',
    '<i>Untuk tanggal lain, ketik perintahnya langsung, misalnya</i>',
    '<code>/hadir 2026-11-02</code>.',
  ].join('\n');
}

function menuKeyboard() {
  return {
    inline_keyboard: MENU_ROWS.map((row) =>
      row.map((button) => ({ ...button })),
    ),
  };
}

function idReport(chatId, chat = {}, from = null) {
  const lines = [`🆔 <b>Chat ID:</b> <code>${escapeHtml(chatId)}</code>`];
  lines.push(`Tipe: ${escapeHtml(chat.type || '-')}`);

  if (chat.title) lines.push(`Judul: ${escapeHtml(chat.title)}`);

  if (from) {
    const name = [from.first_name, from.last_name].filter(Boolean).join(' ');
    const username = from.username ? ` (@${from.username})` : '';
    lines.push(`Pengirim: ${escapeHtml(name || '-')}${escapeHtml(username)}`);
    if (from.id !== undefined && from.id !== null) {
      lines.push(`User ID: <code>${escapeHtml(from.id)}</code>`);
    }
  }

  lines.push('');
  if (!config.allowedChats.length && !config.deptHeads.size) {
    lines.push(
      'Saat ini <code>ALLOWED_CHATS</code> kosong, sehingga semua chat dapat mengakses data.',
    );
    lines.push(
      'Isi <code>ALLOWED_CHATS</code> dengan ID di atas, lalu restart bot untuk membatasi akses.',
    );
  } else {
    lines.push('ID di atas dapat dipakai di <code>ALLOWED_CHATS</code> untuk akses penuh.');
    lines.push(
    'Untuk dept head, isi <code>DEPT_HEADS</code> dengan format ' +
    '<code>chatId=dept1|dept2</code> (satu atau lebih departemen).',
    );
  }

  return lines.join('\n');
}

function deniedReport(chatId) {
  return [
    '⛔ <b>Akses ditolak.</b>',
    `Chat ID Anda: <code>${escapeHtml(chatId)}</code>`,
    '',
    'Minta admin menambahkan ID tersebut ke salah satu pengaturan:',
    '• <code>ALLOWED_CHATS</code> untuk akses semua departemen, atau',
    '• <code>DEPT_HEADS</code> untuk akses satu atau lebih departemen.',
    'Lalu restart bot.',
  ].join('\n');
}

function dateFormatHint() {
  return 'Format tanggal: <code>2026-11-02</code> atau <code>02-11-2026</code>.';
}

function monthFormatHint() {
  return 'Format bulan: <code>2026-11</code> atau <code>11-2026</code>.';
}

module.exports = {
  escapeHtml,
  todayReport,
  lateReport,
  absentReport,
  offReport,
  presentReport,
  employeeReport,
  searchResultsReport,
  departmentReport,
  weekReport,
  monthReport,
  employeeMonthReport,
  monthSearchResultsReport,
  helpText,
  menuText,
  menuKeyboard,
  idReport,
  deniedReport,
  dateFormatHint,
  monthFormatHint,
  summaryLines,
};
