'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
config.excludeDepartments = ['FORMER STAFF', ' HEAD OFFICE '];

const dbPath = require.resolve('../src/db');
const rows = [
  { userId: 1, badgeNumber: 'A1', name: 'Aktif', deptId: 1, deptName: 'DEPARTMENT A' },
  { userId: 2, badgeNumber: 'A2', name: 'Resign', deptId: 2, deptName: 'former staff' },
  { userId: 3, badgeNumber: 'A3', name: 'Kantor', deptId: 3, deptName: 'Head Office' },
  { userId: 4, badgeNumber: 'A4', name: 'Harian', deptId: 4, deptName: 'X DAILY WORKER X' },
];

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (text) => {
      if (text.includes('FROM USERINFO')) return rows;
      throw new Error('Query tidak dikenal');
    },
  },
};

const { getEmployees } = require('../src/schedule');

test('getEmployees menyaring departemen yang dikecualikan', async () => {
  const employees = await getEmployees();
  assert.deepEqual(
    employees.map((employee) => employee.name),
    ['Aktif', 'Harian'],
  );
});
