'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLogNotifier } = require('../src/notify');

test('createLogNotifier tidak aktif tanpa token atau chat id', () => {
  assert.equal(createLogNotifier({}), null);
  assert.equal(createLogNotifier({ token: 'x' }), null);
  assert.equal(createLogNotifier({ chatId: '1' }), null);
});

test('createLogNotifier mengirim log dengan label ke chat tujuan', async () => {
  const calls = [];
  const notifier = createLogNotifier({
    chatId: '123',
    label: 'absensi-bot',
    client: {
      call: async (method, payload) => {
        calls.push({ method, payload });
      },
    },
  });

  await notifier.send('[in] chat=1 text="/today"');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'sendMessage');
  assert.equal(calls[0].payload.chat_id, '123');
  assert.equal(calls[0].payload.text, '[absensi-bot] [in] chat=1 text="/today"');
});

test('createLogNotifier memotong log yang terlalu panjang', async () => {
  const calls = [];
  const notifier = createLogNotifier({
    chatId: '123',
    client: {
      call: async (method, payload) => {
        calls.push(payload.text);
      },
    },
  });

  await notifier.send('x'.repeat(5000));
  assert.equal(calls[0].length, 3900);
  assert.match(calls[0], /…$/);
});

test('createLogNotifier melanjutkan antrean setelah pengiriman gagal', async () => {
  const calls = [];
  let first = true;
  const notifier = createLogNotifier({
    chatId: '123',
    client: {
      call: async (method, payload) => {
        calls.push(payload.text);
        if (first) {
          first = false;
          throw new Error('Telegram down');
        }
      },
    },
  });

  await notifier.send('pertama');
  await notifier.send('kedua');

  assert.equal(calls.length, 2);
  assert.match(calls[1], /kedua/);
});
