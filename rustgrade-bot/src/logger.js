'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'rustbot.log');

let fileStream = null;
function ensureStream() {
  if (fileStream) return fileStream;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fileStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  } catch (_) {
    fileStream = null;
  }
  return fileStream;
}

function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function fmt(arg) {
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch (_) {
    return String(arg);
  }
}

function emit(level, method, args) {
  const line = `[${stamp()}] [${level}] ${args.map(fmt).join(' ')}`;
  try {
    (console[method] || console.log)(line);
  } catch (_) {
    /* консолі може не бути у прихованому вікні */
  }
  const s = ensureStream();
  if (s) {
    try {
      s.write(line + '\n');
    } catch (_) {
      /* ігнор */
    }
  }
}

function log(...args) {
  emit('info', 'log', args);
}

log.info = (...args) => emit('info', 'log', args);
log.warn = (...args) => emit('warn', 'warn', args);
log.error = (...args) => emit('error', 'error', args);
log.debug = (...args) => {
  if (process.env.DEBUG) emit('debug', 'log', args);
};

module.exports = log;