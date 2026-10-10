'use strict';

const https = require('https');
const log = require('./logger');

const RUST_APP_ID = '252490';

// Достаёт содержимое тега, разворачивая CDATA.
function tag(xml, name) {
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`);
  const m = xml.match(re);
  if (!m) return '';
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .trim();
}

function parseHours(s) {
  if (!s) return null;
  const n = Number(String(s).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseProfile(xml) {
  const profile = {
    steamId: tag(xml, 'steamID64'),
    name: tag(xml, 'steamID'),
    privacyState: tag(xml, 'privacyState'),
    onlineState: tag(xml, 'onlineState'),
    stateMessage: tag(xml, 'stateMessage'),
    avatar: tag(xml, 'avatarFull') || tag(xml, 'avatarMedium'),
    location: tag(xml, 'location'),
    realname: tag(xml, 'realname'),
    memberSince: tag(xml, 'memberSince'),
    vacBanned: tag(xml, 'vacBanned') === '1',
    tradeBanState: tag(xml, 'tradeBanState'),
    limited: tag(xml, 'isLimitedAccount') === '1',
    hours2Weeks: parseHours(tag(xml, 'hoursPlayed2Wk')) || 0,
    rustHours: null,
    rustHours2Wk: null,
    fetchedAt: Date.now(),
  };

  // Ищем Rust среди самых играемых игр (по имени или appId).
  const games = xml.split('<mostPlayedGame>').slice(1);
  for (const g of games) {
    const gname = tag(g, 'gameName');
    const stats = tag(g, 'statsName');
    if (gname === 'Rust' || stats === RUST_APP_ID) {
      profile.rustHours = parseHours(tag(g, 'hoursOnRecord'));
      profile.rustHours2Wk = parseHours(tag(g, 'hoursPlayed'));
      break;
    }
  }
  return profile;
}

/**
 * Профили Steam через публичный XML (steamcommunity.com/.../?xml=1) — без API-ключа.
 * Кэш на 30 минут, чтобы не спамить Steam.
 */
class Steam {
  constructor({ ttlMs = 30 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.cache = new Map(); // steamId -> { at, profile }
    this.pending = new Map(); // steamId -> Promise
  }

  peek(steamId) {
    const c = this.cache.get(String(steamId));
    return c ? c.profile : null;
  }

  async get(steamId) {
    const id = String(steamId || '');
    if (!/^\d{17}$/.test(id)) return null;
    const c = this.cache.get(id);
    if (c && Date.now() - c.at < this.ttlMs) return c.profile;
    if (this.pending.has(id)) return this.pending.get(id);

    const p = this._fetch(id)
      .then((profile) => {
        this.cache.set(id, { at: Date.now(), profile });
        this.pending.delete(id);
        return profile;
      })
      .catch((err) => {
        this.pending.delete(id);
        log.warn(`Steam: профиль ${id} не получен (${err.message})`);
        return c ? c.profile : null;
      });

    this.pending.set(id, p);
    return p;
  }

  // Принимает Steam ID, ссылку на профиль или кастомный URL и возвращает Steam ID64.
  async resolve(query) {
    const q = String(query || '').trim();
    if (/^\d{17}$/.test(q)) return q;
    const mProfile = q.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
    if (mProfile) return mProfile[1];
    const mId = q.match(/steamcommunity\.com\/id\/([^/\s?#]+)/i);
    const vanity = mId ? mId[1] : q;
    if (!/^[A-Za-z0-9_.\-]{2,64}$/.test(vanity)) return null;
    return this._resolveVanity(vanity);
  }

  _resolveVanity(vanity) {
    return new Promise((resolve, reject) => {
      const url = `https://steamcommunity.com/id/${encodeURIComponent(vanity)}/?xml=1`;
      const req = https.get(url, { headers: { 'User-Agent': 'RustBot/1.0' } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
          if (data.length > 3_000_000) req.destroy(new Error('too large'));
        });
        res.on('end', () => {
          const id = tag(data, 'steamID64');
          resolve(/^\d{17}$/.test(id) ? id : null);
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    });
  }

  _fetch(steamId) {
    return new Promise((resolve, reject) => {
      const url = `https://steamcommunity.com/profiles/${steamId}/?xml=1`;
      const req = https.get(url, { headers: { 'User-Agent': 'RustBot/1.0' } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
          if (data.length > 3_000_000) req.destroy(new Error('too large'));
        });
        res.on('end', () => {
          try {
            resolve(parseProfile(data));
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    });
  }
}

module.exports = Steam;
