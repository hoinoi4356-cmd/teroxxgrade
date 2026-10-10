'use strict';

// AppMarkerType values taken from rustplus.proto of @liamcottle/rustplus.js
const MARKER_TYPES = {
  0: 'Undefined',
  1: 'Player',
  2: 'Explosion',
  3: 'VendingMachine',
  4: 'CH47',
  5: 'CargoShip',
  6: 'Crate',
  7: 'GenericRadius',
  8: 'PatrolHelicopter',
};

// Обратный индекс имя -> число. Rust+ (protobufjs) может вернуть enum
// как строку ("CargoShip"), а не число — нормализуем оба варианта.
const TYPE_BY_NAME = {};
for (const [num, name] of Object.entries(MARKER_TYPES)) {
  TYPE_BY_NAME[String(name).toLowerCase()] = Number(num);
}

function markerTypeNumber(type) {
  if (typeof type === 'number') return type;
  const raw = String(type == null ? '' : type).trim();
  if (raw === '') return -1;
  if (!Number.isNaN(Number(raw))) return Number(raw);
  const byName = TYPE_BY_NAME[raw.toLowerCase()];
  return byName !== undefined ? byName : -1;
}

const MARKER_EMOJI = {
  2: ':boom:',
  3: ':shopping_cart:',
  4: ':helicopter:',
  5: ':ship:',
  6: ':parachute:',
  7: ':rotating_light:',
  8: ':helicopter:',
};

// Friendly names for alerts
const MARKER_LABEL = {
  2: 'Explosion',
  3: 'Vending machine',
  4: 'Chinook CH-47',
  5: 'Cargo Ship',
  6: 'Airdrop / Crate',
  7: 'Event',
  8: 'Patrol Helicopter',
};

// Русские названия для игрового чата и Discord
const MARKER_LABEL_RU = {
  2: 'Взрыв',
  3: 'Магазин',
  4: 'Chinook CH-47',
  5: 'Корабль (Cargo)',
  6: 'Аирдроп / ящик',
  7: 'Событие',
  8: 'Патрульный вертолёт',
};

function markerLabelRu(type) {
  return MARKER_LABEL_RU[markerTypeNumber(type)] || markerLabel(type);
}

function markerTypeName(type) {
  return MARKER_TYPES[markerTypeNumber(type)] || `Type ${type}`;
}

function markerLabel(type) {
  return MARKER_LABEL[markerTypeNumber(type)] || markerTypeName(type);
}

function markerEmoji(type) {
  return MARKER_EMOJI[markerTypeNumber(type)] || ':pushpin:';
}

/**
 * Rust map grid label for a world coordinate (matches the in-game grid).
 * Based on the reference implementation used by rustplus.py / Rust+ tools:
 *   - cell size is a fixed GRID_DIAMETER (~146.29 m);
 *   - columns are letters A..Z then AA..ZZ (west -> east, x grows east);
 *   - rows count from the NORTH edge (top) downward: row = (mapSize - y) / cell.
 * The Y axis in Rust grows to the north, while grid rows grow to the south,
 * so the row must be computed from (mapSize - y).
 */
const GRID_DIAMETER = 146.28571428571428;

function gridLetters() {
  const single = [];
  for (let c = 0; c < 26; c++) single.push(String.fromCharCode(65 + c));
  const double = [];
  for (const a of single) for (const b of single) double.push(a + b);
  return single.concat(double);
}
const GRID_LETTERS = gridLetters();

function gridLabel(x, y, mapSize) {
  const size = Number(mapSize) || 0;
  const px = Number(x) || 0;
  const py = Number(y) || 0;
  const col = Math.max(0, Math.floor(px / GRID_DIAMETER));
  // рядки рахуються від півночі (верх карти), тому дзеркалимо Y
  const row = Math.max(0, Math.floor((size - py) / GRID_DIAMETER));
  const letters = GRID_LETTERS[col] || String(col);
  return `${letters}${row}`;
}

module.exports = { MARKER_TYPES, markerTypeNumber, markerTypeName, markerLabel, markerLabelRu, markerEmoji, gridLabel, GRID_DIAMETER };
