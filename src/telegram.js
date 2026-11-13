'use strict';

class TelegramError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'TelegramError';
    this.statusCode = options.statusCode;
    this.description = options.description;
    this.retryAfter = options.retryAfter;
    if (options.cause) this.cause = options.cause;
  }
}

function stripHtml(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Memecah pesan panjang pada batas baris agar tidak melewati limit Telegram.
 * Limit dibuat 3900 karakter (bukan 4096) untuk ruang aman.
 */
function splitMessage(text, limit = 3900) {
  if (text.length <= limit) return [text];

  const chunks = [];
  let current = '';

  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;

    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = '';
    }

    if (line.length <= limit) {
      current = line;
      continue;
    }

    // Baris tunggal yang sangat panjang: potong paksa.
    for (let index = 0; index < line.length; index += limit) {
      const part = line.slice(index, index + limit);
      if (part.length === limit) chunks.push(part);
      else current = part;
    }
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks : [''];
}

class TelegramClient {
  constructor(token, options = {}) {
    if (!token) throw new Error('Token Telegram belum diisi.');

    this.token = token;
    this.baseUrl = options.baseUrl || 'https://api.telegram.org';
    this.timeoutMs = options.timeoutMs || 30000;
  }

  async call(method, payload = {}, options = {}) {
    const timeoutMs = options.timeoutMs || this.timeoutMs;
    const url = `${this.baseUrl}/bot${this.token}/${method}`;

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error.name === 'TimeoutError' || error.name === 'AbortError'
        ? 'timeout'
        : error.message;
      throw new TelegramError(`Telegram ${method} gagal: ${reason}`, { cause: error });
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new TelegramError(`Telegram ${method} mengembalikan respons tidak valid.`, {
        statusCode: response.status,
        cause: error,
      });
    }

    if (!response.ok || !data.ok) {
      const description = data.description || response.statusText || 'unknown error';
      throw new TelegramError(`Telegram ${method} gagal: ${description}`, {
        statusCode: response.status,
        description,
        retryAfter: data.parameters?.retry_after,
      });
    }

    return data.result;
  }

  async getMe() {
    return this.call('getMe', {}, { timeoutMs: 15000 });
  }

  async setMyCommands(commands) {
    return this.call('setMyCommands', { commands }, { timeoutMs: 15000 });
  }

  async getUpdates(offset, timeoutSec) {
    const payload = {
      timeout: timeoutSec,
      allowed_updates: ['message', 'callback_query'],
    };
    if (offset) payload.offset = offset;

    return this.call('getUpdates', payload, {
      timeoutMs: (timeoutSec + 15) * 1000,
    });
  }

  async answerCallbackQuery(callbackQueryId, text) {
    const payload = { callback_query_id: callbackQueryId };
    if (text) payload.text = text;
    return this.call('answerCallbackQuery', payload, { timeoutMs: 10000 });
  }

  async sendMessage(chatId, text, options = {}) {
    const chunks = splitMessage(text);
    let lastResult = null;

    for (const chunk of chunks) {
      lastResult = await this.sendChunk(chatId, chunk, options);
    }

    return lastResult;
  }

  async sendChunk(chatId, text, options = {}) {
    try {
      return await this.call('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...options,
      });
    } catch (error) {
      // Jika HTML tidak valid, kirim ulang sebagai teks biasa.
      if (error.description && /parse entities|can't parse/i.test(error.description)) {
        const { parse_mode, ...rest } = options;
        return this.call('sendMessage', {
          chat_id: chatId,
          text: stripHtml(text),
          disable_web_page_preview: true,
          ...rest,
        });
      }
      throw error;
    }
  }

  async sendChatAction(chatId, action = 'typing') {
    return this.call(
      'sendChatAction',
      { chat_id: chatId, action },
      { timeoutMs: 10000 },
    );
  }
}

module.exports = {
  TelegramClient,
  TelegramError,
  splitMessage,
  stripHtml,
};
