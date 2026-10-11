'use strict';

const EventEmitter = require('events');
const RustPlus = require('@liamcottle/rustplus.js');
const log = require('./logger');
const chatLog = require('./chat-log');
const { markerLabel, markerTypeName, markerTypeNumber } = require('./markers');

// Пауза перед КОЖНИМ повідомленням бота в чат гри. Бот пише від імені самого
// гравця, тому його повідомлення й відповідь бота не повинні летіти в межах
// кулдауну чату Rust (~3 с) — інакше сервер каже «занадто швидко».
const SEND_INTERVAL_MS = 4000;

/**
 * Thin, resilient wrapper around @liamcottle/rustplus.js.
 *
 * Emits:
 *   connected, disconnected, error
 *   serverInfo (info)               - server info object
 *   teamInfo (teamInfo)             - team info object
 *   teamMessage ({steamId,name,text})
 *   clanMessage ({steamId,name,text})
 *   entityChanged ({entityId,value,capacity,items})
 *   deviceState ({entityId,name,entity})
 *   mapMarkers ([markers])
 *   markerSpawn ({type,typeName,label,marker})
 *   memberOnline ({steamId,name,online})
 *   memberDeath ({steamId,name})
 */
class RustPlusManager extends EventEmitter {
  constructor(config, account) {
    super();
    this.config = config;
    this.account = account || {
      name: (config.settings && config.settings.botName) || 'RustBot',
      ...(config.rustplus || {}),
    };
    this.rust = null;
    this.connected = false;
    this.stopped = false;
    this.reconnectDelay = 5000;
    this.reconnectTimer = null;
    this._timers = [];
    this._lastMarkers = new Map();
    this._eventMarkers = [];
    this._lastTeamState = new Map();
    this._recentDeaths = []; // останні смерті команди (для живої карти)
    this._notes = new Map(); // командні мітки на карті (leader/team)
    this._notesSeeded = false;
    this._mapCache = null;
    this._infoCache = null;
    this._infoCacheAt = 0;
    this.mapSize = 0;
    this._deviceIds = new Map(); // entityId -> name
    this._sentTexts = new Map(); // text -> timestamp (щоб відфільтрувати власні відлуння)
    this._sendQueue = []; // черга повідомлень у чат гри
    this._sendTimer = null;
  }

  get playerId() {
    return String((this.account && this.account.playerId) || '');
  }

  get accountName() {
    return (this.account && this.account.name) || this.botName;
  }

  get botName() {
    return (this.config.settings && this.config.settings.botName) || 'RustBot';
  }

  // ---------------------------------------------------------------- connection

  connect() {
    this.stopped = false;
    const { serverIp, appPort, playerId, playerToken } = this.account;
    log.info(`Rust+ [${this.accountName}]: подключение к ${serverIp}:${appPort} как ${playerId}`);

    this.rust = new RustPlus(String(serverIp), String(appPort), String(playerId), String(playerToken));

    this.rust.on('connecting', () => log.info('Rust+: connecting...'));
    this.rust.on('connected', () => {
      this.connected = true;
      this.reconnectDelay = 5000;
      log.info('Rust+: connected ✔');
      this.emit('connected');
      this.startPolling();
    });
    this.rust.on('disconnected', () => {
      this.connected = false;
      this.stopPolling();
      if (this._sendTimer) clearTimeout(this._sendTimer);
      this._sendTimer = null;
      this._sendQueue = [];
      log.warn('Rust+: disconnected');
      this.emit('disconnected');
      this.scheduleReconnect();
    });
    this.rust.on('error', (err) => {
      log.error('Rust+ error:', err && err.message ? err.message : err);
      this.emit('error', err);
    });
    this.rust.on('message', (message) => this._handleMessage(message));

    try {
      this.rust.connect();
    } catch (err) {
      log.error('Rust+ connect() failed:', err.message);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    log.info(`Rust+: повтор через ${Math.round(delay / 1000)} с`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000);
      this.connect();
    }, delay);
  }

  stop() {
    this.stopped = true;
    this.stopPolling();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this._sendTimer) clearTimeout(this._sendTimer);
    this._sendTimer = null;
    this._sendQueue = [];
    try {
      if (this.rust && typeof this.rust.disconnect === 'function') this.rust.disconnect();
    } catch (_) {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------ messages

  _handleMessage(message) {
    if (!message || !message.broadcast) return;
    const b = message.broadcast;

    if (b.teamMessage) {
      const tm = b.teamMessage;
      const chat = tm.message || {};
      const text = (chat.message || '').trim();
      // не реагуємо на власні повідомлення бота (сервер віддає їх назад)
      if (this._isOwnEcho(text)) return;
      log.info(`Chat <${chat.name || 'Unknown'}> ${text}`);
      chatLog.line(`[Игра] ${chat.name || 'Unknown'}: ${text}`, this.accountName);
      this.emit('teamMessage', {
        steamId: String(chat.steamId || ''),
        name: chat.name || 'Unknown',
        text,
      });
      return;
    }

    if (b.clanMessage) {
      const cm = b.clanMessage;
      const chat = cm.message || {};
      const cname = cm.name || chat.ownerName || 'Unknown';
      const ctext = (chat.message || '').trim();
      chatLog.line(`[Клан] ${cname}: ${ctext}`, this.accountName);
      this.emit('clanMessage', {
        steamId: String(cm.playerId || chat.steamId || ''),
        name: cname,
        text: ctext,
      });
      return;
    }

    if (b.entityChanged) {
      const ec = b.entityChanged;
      const payload = ec.payload || {};
      this.emit('entityChanged', {
        entityId: ec.entityId,
        value: !!payload.value,
        capacity: payload.capacity,
        items: payload.items || [],
      });
      return;
    }
  }

  _isOwnEcho(text) {
    const t = this._sentTexts.get(text);
    if (!t) return false;
    if (Date.now() - t > 30000) {
      this._sentTexts.delete(text);
      return false;
    }
    return true;
  }

  // --------------------------------------------------------------- requests

  _call(method, timeoutMs = 8000) {
    return new Promise((resolve) => {
      if (!this.rust || !this.connected || typeof this.rust[method] !== 'function') {
        resolve(null);
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, timeoutMs);
      try {
        this.rust[method]((message) => {
          if (settled) return true;
          settled = true;
          clearTimeout(timer);
          // бібліотека віддає повне AppMessage; корисні дані — у .response
          resolve((message && message.response) || message || null);
          return true;
        });
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          log.debug(`Rust+ ${method} threw:`, err.message);
          resolve(null);
        }
      }
    });
  }

  async getInfoAsync(force = false) {
    if (!force && this._infoCache && Date.now() - this._infoCacheAt < 20000) return this._infoCache;
    const msg = await this._call('getInfo');
    const info = msg && msg.info ? msg.info : null;
    if (info) {
      this._infoCache = info;
      this._infoCacheAt = Date.now();
      if (info.mapSize) this.mapSize = Number(info.mapSize);
    }
    return info;
  }

  async getTimeAsync() {
    const msg = await this._call('getTime');
    return msg && msg.time ? msg.time : null;
  }

  async getMapAsync(force = false) {
    if (!force && this._mapCache) return this._mapCache;
    const msg = await this._call('getMap', 12000);
    const map = msg && msg.map ? msg.map : null;
    if (map) this._mapCache = map;
    return map;
  }

  async getTeamInfoAsync() {
    const msg = await this._call('getTeamInfo');
    const team = msg && msg.teamInfo ? msg.teamInfo : null;
    if (team) this.lastTeamInfo = team;
    return team;
  }

  async getMapMarkersAsync() {
    const msg = await this._call('getMapMarkers');
    if (!msg || !msg.mapMarkers) return null;
    return msg.mapMarkers.markers || [];
  }

  async getEntityInfoAsync(entityId, timeoutMs = 8000) {
    const msg = await this._callEntity(entityId, timeoutMs);
    return msg && msg.entityInfo ? msg.entityInfo : null;
  }

  _callEntity(entityId, timeoutMs) {
    return new Promise((resolve) => {
      if (!this.rust || !this.connected) {
        resolve(null);
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, timeoutMs);
      try {
        this.rust.getEntityInfo(entityId, (message) => {
          if (settled) return true;
          settled = true;
          clearTimeout(timer);
          resolve((message && message.response) || message || null);
          return true;
        });
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      }
    });
  }

  // ---------------------------------------------------------------- actions

  sendTeamMessage(text) {
    if (!this.rust || !this.connected) {
      log.warn('Rust+: sendTeamMessage пропущено (нет соединения)');
      return false;
    }
    const safe = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 128);
    if (!safe) return false;
    this._queueSend(safe, false);
    return true;
  }

  sendClanMessage(text) {
    if (!this.rust || !this.connected) return false;
    const safe = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 128);
    if (!safe) return false;
    this._queueSend(safe, true);
    return true;
  }

  // Черга відправлень у чат гри. Бот пише від імені самого гравця, тому кожне
  // повідомлення (і командний, і клановий чат) чекає SEND_INTERVAL_MS — щоб не
  // влетіти в кулдаун чату (~3 с) разом із командою/повідомленням гравця.
  _queueSend(text, clan) {
    this._sendQueue.push({ text, clan });
    if (this._sendTimer) return;
    const tick = () => {
      this._sendTimer = null;
      const item = this._sendQueue.shift();
      if (item === undefined) return;
      this._sendOne(item);
      if (this._sendQueue.length) this._sendTimer = setTimeout(tick, SEND_INTERVAL_MS);
    };
    this._sendTimer = setTimeout(tick, SEND_INTERVAL_MS);
  }

  _sendOne(item) {
    const msg = item.text;
    try {
      if (item.clan) {
        if (typeof this.rust.sendClanMessage === 'function') {
          this.rust.sendClanMessage(msg);
        } else {
          this.rust.sendRequest({ sendClanMessage: { message: msg } }, () => true);
        }
        chatLog.line(`[Бот → Клан${this.accountName ? ` (${this.accountName})` : ''}] ${msg}`, this.accountName);
        return;
      }
      this.rust.sendTeamMessage(msg);
      this._sentTexts.set(msg, Date.now());
      for (const [k, t] of this._sentTexts) {
        if (Date.now() - t > 30000) this._sentTexts.delete(k);
      }
      log.info(`Rust+: > ${msg}`);
      chatLog.line(`[Бот${this.accountName ? ` (${this.accountName})` : ''}] ${msg}`, this.accountName);
    } catch (err) {
      log.error(`Rust+: send failed: ${msg} (${err.message})`);
    }
  }

  async turnSmartSwitch(entityId, on) {
    if (!this.rust || !this.connected) return false;
    return new Promise((resolve) => {
      try {
        const fn = on ? 'turnSmartSwitchOn' : 'turnSmartSwitchOff';
        if (typeof this.rust[fn] !== 'function') return resolve(false);
        this.rust[fn](entityId, () => {
          resolve(true);
          return true;
        });
      } catch (err) {
        resolve(false);
      }
    });
  }

  // ----------------------------------------------------------------- polling

  startPolling() {
    this.stopPolling();
    const pollMs = Math.max(10, Number(this.config.settings.pollMapMarkersSeconds || 20)) * 1000;

    this.pollMapMarkers();
    this.refreshTeamInfo();
    this.getInfoAsync(true).then((info) => info && this.emit('serverInfo', info));
    this.pollDevices();

    this._timers.push(setInterval(() => this.pollMapMarkers(), pollMs));
    this._timers.push(setInterval(() => this.refreshTeamInfo(), Math.max(pollMs, 15000)));
    this._timers.push(setInterval(() => this.pollDevices(), 60000));
  }

  stopPolling() {
    for (const t of this._timers) clearInterval(t);
    this._timers = [];
  }

  async refreshTeamInfo() {
    const team = await this.getTeamInfoAsync();
    if (!team) return;
    this.emit('teamInfo', team);
    this._detectTeamChanges(team);
    this._detectTeamNotes(team, team.leaderSteamId);
  }

  // Командні мітки на карті (Rust+ досі їх віддає, на відміну від івент-маркерів).
  // leaderMapNotes — мітки лідера, mapNotes — решта. Шлемо подію про нові.
  _detectTeamNotes(team, leaderSteamId) {
    const now = new Map();
    const add = (list, by) => {
      for (const n of list || []) {
        const x = Number(n.x) || 0;
        const y = Number(n.y) || 0;
        now.set(`${Math.round(x)}:${Math.round(y)}`, { x, y, type: Number(n.type) || 0, by });
      }
    };
    add(team.leaderMapNotes, 'leader');
    add(team.mapNotes, 'team');

    if (this._notesSeeded) {
      for (const [key, note] of now) {
        if (!this._notes.has(key)) this.emit('teamNote', note);
      }
    }
    this._notesSeeded = true;
    this._notes = now;
  }

  teamNotes() {
    return [...this._notes.values()];
  }

  // Актуальний стан складу команди з останнього опитування teamInfo:
  // steamId, name, isOnline, isAlive, x, y, deathTime.
  teamMemberStates() {
    return [...this._lastTeamState.values()];
  }

  _detectTeamChanges(team) {
    const members = team.members || [];
    const now = new Map();
    for (const m of members) {
      now.set(String(m.steamId), {
        isOnline: !!m.isOnline,
        isAlive: !!m.isAlive,
        name: m.name || 'Unknown',
        x: Number(m.x) || 0,
        y: Number(m.y) || 0,
        deathTime: Number(m.deathTime) || 0,
      });
    }
    if (this._lastTeamState.size > 0) {
      for (const [id, state] of now) {
        const prev = this._lastTeamState.get(id);
        if (!prev) continue;
        if (prev.isOnline !== state.isOnline) {
          this.emit('memberOnline', { steamId: id, name: state.name, online: state.isOnline });
        }
        // смерть ловимо надійно: або впав isAlive, або оновився deathTime
        const died =
          (prev.isAlive && !state.isAlive) ||
          (state.deathTime > 0 && state.deathTime > (prev.deathTime || 0));
        if (died) {
          log.info(`Death: ${state.name} @ ${Math.round(state.x)},${Math.round(state.y)}`);
          this._recentDeaths.push({
            name: state.name,
            x: state.x,
            y: state.y,
            at: Date.now(),
          });
          if (this._recentDeaths.length > 12) this._recentDeaths.shift();
          this.emit('memberDeath', {
            steamId: id,
            name: state.name,
            x: state.x,
            y: state.y,
            deathTime: state.deathTime,
          });
        }
      }
    }
    this._lastTeamState = now;
  }

  async pollMapMarkers() {
    const raw = await this.getMapMarkersAsync();
    if (!raw) return;

    // Rust+ может вернуть тип enum как строку ("CargoShip") или число —
    // приводим к числу, иначе фильтр eventMarkerTypes никогда не сработает.
    const markers = raw.map((m) => ({ ...m, typeNum: markerTypeNumber(m.type) }));

    // перше опитування після запуску — просто запам'ятовуємо маркери,
    // щоб не заспамити чат усіма наявними івентами одночасно
    const firstPoll = !this._markersSeeded;
    this._markersSeeded = true;

    const eventTypes = new Set((this.config.settings.eventMarkerTypes || []).map(Number));
    const current = new Map();
    for (const m of markers) {
      const key = `${m.typeNum}:${Math.round(m.x)}:${Math.round(m.y)}`;
      current.set(key, m);
    }

    // New markers -> spawn events
    for (const [key, m] of current) {
      if (firstPoll || this._lastMarkers.has(key)) continue;
      if (eventTypes.has(m.typeNum)) {
        this.emit('markerSpawn', {
          type: m.typeNum,
          typeName: markerTypeName(m.typeNum),
          label: markerLabel(m.typeNum),
          marker: m,
        });
      }
    }

    this._lastMarkers = current;
    this._eventMarkers = markers.filter((m) => eventTypes.has(m.typeNum));
    this.emit('mapMarkers', markers);
  }

  currentEventMarkers() {
    return this._eventMarkers.slice();
  }

  recentDeaths() {
    return this._recentDeaths.slice();
  }

  async pollDevices() {
    const devices = this.config.settings.devices || [];
    if (!devices.length) return;
    for (const device of devices) {
      if (device == null) continue;
      const id = typeof device === 'object' ? device.id : device;
      const name = typeof device === 'object' ? device.name || `#${id}` : `#${id}`;
      if (id == null) continue;
      this._deviceIds.set(Number(id), name);
      const entity = await this.getEntityInfoAsync(Number(id));
      if (entity) this.emit('deviceState', { entityId: Number(id), name, entity });
    }
  }
}

module.exports = RustPlusManager;
