'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./logger');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'players.json');

/**
 * Реестр всех игроков, которых бот когда-либо видел:
 * команда, чат, смерти. Позволяет искать по нику (не только команду)
 * и видеть, кто онлайн / когда последний раз заходил.
 */
class PlayerRegistry {
  constructor() {
    this.data = {}; // steamId -> { steamId, name, firstSeen, lastSeen, lastOnline, online, deaths, chats, team }
    this._dirty = false;
    this._timer = null;
    this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (raw && typeof raw === 'object') this.data = raw;
    } catch (_) {
      /* первый запуск */
    }
  }

  _save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(this.data));
      this._dirty = false;
    } catch (err) {
      log.error('Players: сохранение не удалось:', err.message);
    }
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      if (this._dirty) this._save();
    }, 30000);
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this._save();
  }

  _entry(steamId, name) {
    const id = String(steamId || '');
    if (!id || id === 'undefined') return null;
    let e = this.data[id];
    const now = Date.now();
    if (!e) {
      e = { steamId: id, name: name || '?', firstSeen: now, lastSeen: now, lastOnline: 0, lastIn: 0, lastOut: 0, online: false, deaths: 0, chats: 0, team: false };
      this.data[id] = e;
    }
    if (name) e.name = name;
    e.lastSeen = now;
    this._dirty = true;
    return e;
  }

  seen(steamId, name, opts = {}) {
    const e = this._entry(steamId, name);
    if (!e) return null;
    if (opts.chat) e.chats = (e.chats || 0) + 1;
    if (opts.team) e.team = true;
    return e;
  }

  setOnline(steamId, name, online) {
    const e = this._entry(steamId, name);
    if (!e) return;
    e.team = true;
    const now = Date.now();
    if (online) {
      if (!e.online) e.lastIn = now; // только при входе (переход офлайн->онлайн)
      e.online = true;
      e.lastOnline = now;
    } else {
      if (e.online) e.lastOut = now; // только при выходе
      e.online = false;
    }
  }

  addDeath(steamId, name) {
    const e = this._entry(steamId, name);
    if (!e) return;
    e.deaths = (e.deaths || 0) + 1;
  }

  get(steamId) {
    return this.data[String(steamId)] || null;
  }

  // Привязка Discord-участника к Steam: discordId хранится в карточке игрока.
  linkDiscord(steamId, discordId, name) {
    const e = this._entry(steamId, name);
    if (!e) return null;
    e.discordId = String(discordId || '');
    this._dirty = true;
    return e;
  }

  unlinkDiscord(discordId) {
    const e = this.findByDiscordId(discordId);
    if (!e) return false;
    delete e.discordId;
    this._dirty = true;
    return true;
  }

  findByDiscordId(discordId) {
    const id = String(discordId || '');
    return Object.values(this.data).find((e) => e.discordId === id) || null;
  }

  find(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    if (this.data[q]) return [this.data[q]]; // точный Steam ID
    const all = Object.values(this.data);
    return all
      .filter((e) => (e.name || '').toLowerCase().includes(q))
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  }

  list() {
    return Object.values(this.data).sort((a, b) => {
      if (!!b.online !== !!a.online) return b.online ? 1 : -1;
      return (b.lastSeen || 0) - (a.lastSeen || 0);
    });
  }

  onlineList() {
    return this.list().filter((e) => e.online);
  }

  count() {
    return Object.keys(this.data).length;
  }
}

module.exports = PlayerRegistry;
