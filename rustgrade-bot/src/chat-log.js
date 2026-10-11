'use strict';

/**
 * Історія чату команди — окремий лог-файл `logs/chat.log` поруч із
 * `rustbot.log`. Пишемо сюди ВСЕ, що відбувається навколо гри:
 * повідомлення гравців, відповіді бота, заходи/виходи з сервера,
 * смерті, події, пересилання з Discord у гру. Час — МСК (UTC+3),
 * як у решті повідомлень бота.
 *
 * Окрім запису у файл, кожен рядок ЕМІТИТЬСЯ подією `line`
 * ({ text, account, at }), щоб index.js міг дублювати його у
 * Discord-канал логів (спільний або окремий на акаунт).
 */
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const LOG_DIR = path.resolve(__dirname, '..', 'logs');
const FILE = path.join(LOG_DIR, 'chat.log');

let stream = null;
function ensure() {
  if (stream) return stream;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    stream = fs.createWriteStream(FILE, { flags: 'a' });
  } catch (_) {
    stream = null;
  }
  return stream;
}

/** Поточний час по МСК (Росія без переходу на літній час → UTC+3). */
function msk() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

class ChatLog extends EventEmitter {
  /** Один рядок історії: [час МСК] текст. account — ім'я Rust+ акаунта (для розділення каналів логів). */
  line(text, account) {
    if (text == null) return;
    const s = ensure();
    const at = msk();
    const l = `[${at}] ${String(text)}`;
    if (s) {
      try {
        s.write(l + '\n');
      } catch (_) {
        /* ігнор */
      }
    }
    try {
      this.emit('line', { text: String(text), account: account || null, at });
    } catch (_) {
      /* ігнор */
    }
  }
}

module.exports = new ChatLog();