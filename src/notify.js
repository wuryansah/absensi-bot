'use strict';

const { TelegramClient } = require('./telegram');

const MAX_MESSAGE_LENGTH = 3900;

/**
 * Membuat pengirim notifikasi log ke satu chat Telegram.
 *
 * Notifikasi dikirim berurutan agar tidak melebihi batas Telegram. Kegagalan
 * pengiriman hanya dicatat ke log dan tidak menghentikan bot utama.
 */
function createLogNotifier(options = {}) {
  const token = options.token;
  const chatId = options.chatId;
  const label = options.label || 'absensi-bot';

  if (!options.client && (!token || !chatId)) return null;

  const client = options.client || new TelegramClient(token);
  let queue = Promise.resolve();

  function send(line) {
    let text = `[${label}] ${line}`;
    if (text.length > MAX_MESSAGE_LENGTH) {
      text = `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
    }

    queue = queue
      .then(() => {
        return client.call('sendMessage', {
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        });
      })
      .catch((error) => {
        console.error(`[notify] ${error.message}`);
      });

    return queue;
  }

  return { send };
}

module.exports = { createLogNotifier };
