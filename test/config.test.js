'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseEnv, parseDeptHeads, parseChatNames } = require('../src/config');

test('parseEnv menangani komentar inline dan nilai kosong', () => {
  const values = parseEnv(
    [
      'ALLOWED_CHATS=   # kosong = semua chat',
      'DB_PASSWORD="p#ss word"',
      'DB_USER=sa # komentar',
      'export TZ=Asia/Jakarta',
      '',
      '# baris komentar',
    ].join('\n'),
  );

  assert.equal(values.ALLOWED_CHATS, '');
  assert.equal(values.DB_PASSWORD, 'p#ss word');
  assert.equal(values.DB_USER, 'sa');
  assert.equal(values.TZ, 'Asia/Jakarta');
});

test('parseEnv mendukung escape sederhana di dalam kutip ganda', () => {
  const values = parseEnv('PESAN="baris1\\nbaris2"');
  assert.equal(values.PESAN, 'baris1\nbaris2');
});

test('parseDeptHeads membaca chat id dan departemen', () => {
  const heads = parseDeptHeads('100000001=IT, -100123=HR ,tidak-valid,123=');

  assert.deepEqual(heads.get('100000001'), ['IT']);
  assert.deepEqual(heads.get('-100123'), ['HR']);
  assert.equal(heads.size, 2);
});

test('parseDeptHeads gabungkan banyak departemen per chat id', () => {
  const heads = parseDeptHeads('1=IT|HR,1=Finance');

  assert.deepEqual(heads.get('1'), ['IT', 'HR', 'Finance']);
  assert.equal(heads.size, 1);
});

test('parseChatNames membaca chat id dan nama tampilan', () => {
  const names = parseChatNames(
    '100000001=Budi, -100000002=Grup ,tidak-valid,123=,456=Ani',
  );

  assert.equal(names.get('100000001'), 'Budi');
  assert.equal(names.get('-100000002'), 'Grup');
  assert.equal(names.get('456'), 'Ani');
  assert.equal(names.size, 3);
});
