'use strict';

/**
 * Історія чату команди — окремий лог-файл `logs/chat.log` поруч із
 * `rustbot.log`. Пишемо сюди ВСЕ, що відбувається навколо гри:
 * повідомлення гравців, відповіді бота, заходи/виходи з сервера,
 * смерті, події, пересилання з Discord у гру. Час — МСК (UTC+3),
 * як у решті повідомлень бота.
 */
const fs = require('fs');
const path = require('path');

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

/** Один рядок історії: [час МСК] текст */
function line(text) {
  if (text == null) return;
  const s = ensure();
  const l = `[${msk()}] ${String(text)}`;
  if (s) {
    try {
      s.write(l + '\n');
    } catch (_) {
      /* ігнор */
    }
  }
}

module.exports = { line, msk };