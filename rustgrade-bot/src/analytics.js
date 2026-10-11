'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./logger');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'analytics.json');
const MAX_SAMPLES = 2000; // ~33 ч при семпле раз в минуту

/**
 * Простая локальная аналитика:
 *   - сколько каждый тиммейт наиграл (сессии/секунды онлайна),
 *   - сколько раз умер,
 *   - история онлайна сервера (для графика).
 * Хранится в data/analytics.json, сбрасывается при новом вайпе.
 */
class Analytics {
  constructor() {
    this.data = { wipeStart: 0, start: Date.now(), pop: [], members: {}, paths: {} };
    this.onlineSince = new Map(); // steamId -> ts (текущая сессия)
    this._loaded = false;
    this._dirty = false;
    this._timer = null;
    this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (raw && typeof raw === 'object') {
        this.data = Object.assign(this.data, raw);
        if (!Array.isArray(this.data.pop)) this.data.pop = [];
        if (!this.data.members) this.data.members = {};
        if (!this.data.paths) this.data.paths = {};
        for (const m of Object.values(this.data.members)) {
          if (!Array.isArray(m.history)) m.history = [];
        }
      }
    } catch (_) {
      /* первый запуск — данных ещё нет */
    }
    this._loaded = true;
  }

  _save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(this.data));
      this._dirty = false;
    } catch (err) {
      log.error('Analytics: сохранение не удалось:', err.message);
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

  _member(steamId, name) {
    const id = String(steamId);
    let m = this.data.members[id];
    if (!m) {
      m = { name: name || '?', onlineSeconds: 0, sessions: 0, deaths: 0, lastSeen: 0, history: [] };
      this.data.members[id] = m;
    }
    if (!Array.isArray(m.history)) m.history = [];
    if (name) m.name = name;
    return m;
  }

  memberOnline(steamId, name, online) {
    const id = String(steamId);
    if (!id || id === 'undefined') return;
    const m = this._member(id, name);
    const now = Date.now();
    if (online) {
      if (!this.onlineSince.has(id)) {
        this.onlineSince.set(id, now);
        m.sessions = (m.sessions || 0) + 1;
        m.lastConnected = now;
        // нова сесія: фіксуємо час входу (end=0 — ще в грі)
        m.history.push({ start: now, end: 0 });
        if (m.history.length > 30) m.history.splice(0, m.history.length - 30);
      }
      m.lastSeen = now;
    } else if (this.onlineSince.has(id)) {
      m.onlineSeconds = (m.onlineSeconds || 0) + Math.round((now - this.onlineSince.get(id)) / 1000);
      this.onlineSince.delete(id);
      m.lastSeen = now;
      m.lastDisconnected = now;
      const last = m.history[m.history.length - 1];
      if (last && !last.end) last.end = now;
    }
    this._dirty = true;
  }

  death(steamId, name, x, y) {
    const id = String(steamId);
    if (!id || id === 'undefined') return;
    const m = this._member(id, name);
    m.deaths = (m.deaths || 0) + 1;
    m.lastSeen = Date.now();
    if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
      m.lastDeath = { x: Number(x), y: Number(y), t: Date.now() };
    }
    this._dirty = true;
  }

  // Запись позиции тиммейта (для следа/отслеживания). Пишем, если сместился
  // больше MIN_DIST или прошло больше MIN_MS с прошлой точки.
  position(steamId, name, x, y) {
    const id = String(steamId);
    if (!id || id === 'undefined') return;
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    const m = this._member(id, name);
    const now = Date.now();
    m.lastPos = { x: nx, y: ny, t: now };
    let p = this.data.paths[id];
    if (!p) {
      p = [];
      this.data.paths[id] = p;
    }
    const last = p[p.length - 1];
    const MIN_DIST = 25; // ~ метров мира
    const MIN_MS = 20000;
    if (last) {
      const d = Math.hypot(nx - last.x, ny - last.y);
      if (d < MIN_DIST && now - last.t < MIN_MS) return;
    }
    p.push({ x: nx, y: ny, t: now });
    if (p.length > 200) p.splice(0, p.length - 200);
    this._dirty = true;
  }

  pathOf(steamId, n = 80) {
    const p = this.data.paths[String(steamId)] || [];
    return p.slice(Math.max(0, p.length - n));
  }

  sample(players, wipeTime) {
    const now = Date.now();
    if (wipeTime) {
      const w = Number(wipeTime) * 1000;
      if (this.data.wipeStart && w !== this.data.wipeStart) {
        // новый вайп — обнуляем статистику
        log.info('Analytics: обнаружен новый вайп — сбрасываю статистику');
        this.data.members = {};
        this.data.paths = {};
        this.data.pop = [];
        this.onlineSince.clear();
      }
      this.data.wipeStart = w;
    }
    this.data.pop.push({ t: now, p: Number(players) || 0 });
    if (this.data.pop.length > MAX_SAMPLES) {
      this.data.pop.splice(0, this.data.pop.length - MAX_SAMPLES);
    }
    this._dirty = true;
  }

  popHistory(hours = 6) {
    const since = Date.now() - hours * 3600 * 1000;
    const pts = this.data.pop.filter((s) => s.t >= since);
    // сжимаем до ~120 точек, чтобы не гонять лишнее на веб
    const max = 120;
    if (pts.length <= max) return pts;
    const step = Math.ceil(pts.length / max);
    const out = [];
    for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
    const last = pts[pts.length - 1];
    if (out[out.length - 1] !== last) out.push(last);
    return out;
  }

  _liveSeconds(m, id) {
    let s = m.onlineSeconds || 0;
    if (this.onlineSince.has(id)) s += Math.round((Date.now() - this.onlineSince.get(id)) / 1000);
    return s;
  }

  leaderboard() {
    const out = [];
    const now = Date.now();
    for (const [id, m] of Object.entries(this.data.members)) {
      const hist = Array.isArray(m.history) ? m.history : [];
      // длительность последней сессии
      let lastSession = 0;
      if (hist.length) {
        const s = hist[hist.length - 1];
        lastSession = Math.round(((s.end || now) - s.start) / 1000);
      }
      const live = this._liveSeconds(m, id);
      const avgSession = m.sessions ? Math.round(live / m.sessions) : 0;
      out.push({
        steamId: id,
        name: m.name || '?',
        onlineSeconds: live,
        sessions: m.sessions || 0,
        deaths: m.deaths || 0,
        online: this.onlineSince.has(id),
        lastSeen: m.lastSeen || 0,
        lastConnected: m.lastConnected || 0,
        lastDisconnected: m.lastDisconnected || 0,
        lastSession,
        avgSession,
        lastPos: m.lastPos || null,
        lastDeath: m.lastDeath || null,
        history: hist.slice(-12),
        path: this.pathOf(id, 60),
      });
    }
    out.sort((a, b) => b.onlineSeconds - a.onlineSeconds);
    return out;
  }

  summary() {
    const pop = this.data.pop;
    let peak = 0;
    for (const s of pop) if (s.p > peak) peak = s.p;
    return {
      trackingSince: this.data.start,
      wipeStart: this.data.wipeStart,
      samples: pop.length,
      current: pop.length ? pop[pop.length - 1].p : 0,
      peak,
      popHistory: this.popHistory(6),
      members: this.leaderboard(),
    };
  }
}

module.exports = Analytics;
