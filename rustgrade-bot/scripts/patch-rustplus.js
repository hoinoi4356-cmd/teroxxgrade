'use strict';
// Автопатч бібліотеки @liamcottle/rustplus.js.
//
// Проблема: protobuf.js 7.6.6 при декодуванні перевіряє proto2-поля з міткою `required`
// і кидає "missing required '...'", якщо сервер їх не надіслав. Сучасні сервери Rust
// надсилають відповіді без частини таких полів (queuedPlayers, type у нотатках,
// leaderSteamId коли гравець не в тімі тощо) — і бот падає.
//
// Рішення: конвертуємо УСІ `required` -> `optional`. На відправку запитів це не впливає
// (ми завжди самі задаємо потрібні поля), а декодування стає стійким. Скрипт ідемпотентний.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const proto = path.join(ROOT, 'node_modules', '@liamcottle', 'rustplus.js', 'rustplus.proto');

if (!fs.existsSync(proto)) {
  console.log('[patch] rustplus.proto не найден — библиотека не установлена.');
  process.exit(0);
}

const src = fs.readFileSync(proto, 'utf8');
const count = (src.match(/\brequired\s+/g) || []).length;

if (count === 0) {
  console.log('[patch] всё уже пропатчено (required -> optional) ✔');
  process.exit(0);
}

// замінюємо саме мітки полів: "required " -> "optional "
const patched = src.replace(/\brequired\s+/g, 'optional ');
fs.writeFileSync(proto, patched, 'utf8');
console.log(`[patch] required -> optional: заменено ${count} ✔`);