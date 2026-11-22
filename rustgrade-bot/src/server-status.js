'use strict';

const dgram = require('dgram');
const EventEmitter = require('events');
const log = require('./logger');

/**
 * Реальний онлайн сервера Rust.
 *
 * Джерела (жодне не потребує пароля/токена):
 *   1. A2S — стандартний Steam-запит по UDP на query-порт (за замовчуванням 28017).
 *      Це те саме, що бачить Steam у списку серверів, тому цифри реальні.
 *   2. Rust+ (getInfo) — якщо бот уже спарений, як резервне джерело.
 *
 * Конфіг (config.json → settings.online):
 *   {
 *     "enabled": true,
 *     "provider": "a2s",          // a2s | rustplus | auto
 *     "host": "127.0.0.1",        // адреса сервера (не секрет)
 *     "queryPort": 28017,         // +server.queryport
 *     "refreshSeconds": 60,
 *     "presence": true,           // показувати онлайн у статусі бота
 *     "voiceChannelId": "",       // ID голосового каналу, який перейменовуємо
 *     "voiceChannelFormat": "Онлайн: {players}/{max}"
 *   }
 */

const A2S_INFO_TIMEOUT_MS = 3000;
const MIN_REFRESH_SECONDS = 20;

function buildInfoRequest(challenge) {
  const head = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]);
  const body = Buffer.from('Source Engine Query\0', 'ascii');
  const packet = Buffer.concat([head, body]);
  return challenge ? Buffer.concat([packet, challenge.subarray(0, 4)]) : packet;
}

function readCString(buf, offset) {
  const end = buf.indexOf(0, offset);
  if (end === -1) return null;
  return { value: buf.subarray(offset, end).toString('utf8'), next: end + 1 };
}

/**
 * Розбір A2S_INFO. Повертає { players, maxPlayers, bots, name } або null.
 * Експортується окремо, щоб можна було перевірити без мережі.
 */
function parseInfoPacket(raw) {
  if (!raw || raw.length < 6) return null;
  let buf = raw;
  // повний пакет починається з 0xFFFFFFFF; «голий» payload — ні
  if (buf.readInt32LE(0) === -1) {
    buf = buf.subarray(4);
  }
  if (buf.length < 6) return null;
  if (buf[0] !== 0x49) return null; // 'I'

  let off = 1;
  off += 1; // protocol version

  const name = readCString(buf, off);
  if (!name) return null;
  off = name.next;
  const map = readCString(buf, off);
  if (!map) return null;
  off = map.next;
  const folder = readCString(buf, off);
  if (!folder) return null;
  off = folder.next;
  const game = readCString(buf, off);
  if (!game) return null;
  off = game.next;

  if (off + 2 + 3 > buf.length) return null;
  off += 2; // app id (int16)
  const players = buf[off];
  const maxPlayers = buf[off + 1];
  const bots = buf[off + 2];

  return {
    name: name.value || '',
    map: map.value || '',
    game: game.value || '',
    players: Number(players) || 0,
    maxPlayers: Number(maxPlayers) || 0,
    bots: Number(bots) || 0,
  };
}

function queryA2SOnce(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    let challenged = false;
    const chunks = new Map();
    let expectedChunks = 0;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch (_) {
        /* ignore */
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    const handlePayload = (payload) => {
      const parsed = parseInfoPacket(payload);
      if (parsed) finish(parsed);
    };

    socket.on('message', (msg) => {
      if (!msg || msg.length < 5) return;

      // Challenge: сервер просить повторити запит із 4-байтовим кодом.
      if (msg[0] === 0xff && msg[1] === 0xff && msg[2] === 0xff && msg[3] === 0xff && msg[4] === 0x41) {
        if (challenged || msg.length < 9) return;
        challenged = true;
        send(buildInfoRequest(msg.subarray(5, 9)));
        return;
      }

      // Розбитий пакет (0xFFFFFFFE): збираємо частини.
      if (msg.readInt32LE(0) === -2) {
        if (msg.length < 12) return;
        const id = msg.readInt32LE(4);
        const total = msg[8];
        const number = msg[9];
        let size = msg.readUInt16LE(10);
        if (!expectedChunks) expectedChunks = total;
        if (total !== expectedChunks || total === 0 || total > 16) return;
        if (size === 0 || 12 + size > msg.length) size = msg.length - 12;
        const data = msg.subarray(12, 12 + size);
        chunks.set(`${id}:${number}`, data);
        if (chunks.size < total) return;
        const ordered = [];
        for (let i = 0; i < total; i += 1) ordered.push(chunks.get(`${id}:${i}`));
        if (ordered.some((c) => !c)) return;
        handlePayload(Buffer.concat(ordered));
        return;
      }

      handlePayload(msg);
    });

    socket.on('error', (err) => {
      log.debug('A2S socket error:', err.message);
      finish(null);
    });

    const send = (packet) => {
      try {
        socket.send(packet, port, host);
      } catch (err) {
        log.debug('A2S send error:', err.message);
        finish(null);
      }
    };

    try {
      socket.bind(0, () => send(buildInfoRequest()));
    } catch (err) {
      log.debug('A2S bind error:', err.message);
      finish(null);
    }
  });
}

async function queryA2S(host, port, timeoutMs = A2S_INFO_TIMEOUT_MS) {
  // Одна повторна спроба — UDP може загубити пакет.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await queryA2SOnce(host, port, timeoutMs);
    if (result) return result;
  }
  return null;
}

class ServerStatus extends EventEmitter {
  constructor({ config, manager } = {}) {
    super();
    const settings = (config && config.settings) || {};
    const opts = settings.online || {};
    const rustplus = (config && config.rustplus) || {};

    this.enabled = opts.enabled !== false;
    this.provider = String(opts.provider || 'a2s').toLowerCase();
    this.host = String(opts.host || rustplus.serverIp || '127.0.0.1');
    this.queryPort = Number(opts.queryPort) || 28017;
    this.refreshSeconds = Math.max(MIN_REFRESH_SECONDS, Number(opts.refreshSeconds) || 60);
    this.manager = manager || null;
    this.last = null;
    this.lastAt = 0;
    this.timer = null;
    this._busy = false;
  }

  start() {
    if (!this.enabled) {
      log.info('Онлайн: відключений у налаштуваннях (settings.online.enabled=false)');
      return;
    }
    log.info(`Онлайн: джерело ${this.provider} → ${this.host}:${this.queryPort} (кожні ${this.refreshSeconds} с)`);
    this.tick();
    this.timer = setInterval(() => this.tick(), this.refreshSeconds * 1000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this._busy) return;
    this._busy = true;
    try {
      const status = await this.get(true);
      if (status) this.emit('update', status);
    } finally {
      this._busy = false;
    }
  }

  /**
   * Поточний стан. За замовчуванням віддає кеш (не частіше одного запиту
   * на refreshSeconds), щоб slash-команди не спамили сервер.
   */
  async get(force = false) {
    if (!this.enabled) return null;
    if (!force && this.last && Date.now() - this.lastAt < this.refreshSeconds * 1000) {
      return this.last;
    }

    let result = null;
    if (this.provider === 'a2s' || this.provider === 'auto') {
      result = await queryA2S(this.host, this.queryPort);
      if (result) result.source = 'a2s';
    }

    if (!result && (this.provider === 'rustplus' || this.provider === 'auto')) {
      if (this.manager && typeof this.manager.getInfoAsync === 'function') {
        const info = await this.manager.getInfoAsync(true);
        if (info) {
          result = {
            players: Number(info.players) || 0,
            maxPlayers: Number(info.maxPlayers) || 0,
            bots: 0,
            name: info.name || '',
            map: '',
            source: 'rustplus',
          };
        }
      }
    }

    if (result) {
      this.last = { ...result, ok: true, updatedAt: Date.now() };
      this.lastAt = Date.now();
      return this.last;
    }

    // Нічого не відповіло — лишаємо останні відомі дані, але позначаємо як застарілі.
    if (this.last) {
      return { ...this.last, ok: false, stale: true, checkedAt: Date.now() };
    }
    return { players: 0, maxPlayers: 0, bots: 0, ok: false, source: 'none', updatedAt: 0 };
  }

  snapshot() {
    return this.last ? { ...this.last } : null;
  }
}

module.exports = ServerStatus;
module.exports.queryA2S = queryA2S;
module.exports.parseInfoPacket = parseInfoPacket;
module.exports.buildInfoRequest = buildInfoRequest;
