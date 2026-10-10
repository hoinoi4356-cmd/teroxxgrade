/* ==========================================================================
   server.js — сервер месенджера (стиль Discord)

   Без жодної залежності: тільки вбудований http. Запуск:  node server.js
   Порт: 3001 (змінюється змінною середовища PORT).

   Що вміє:
     • реєстрація / вхід (scrypt-хеші паролів, токени сесій)
     • сервери з каналами (# текстові, ♫ голосові, категорії), ролі,
       запрошувальні посилання, учасники
     • повідомлення: ліміт 2000 символів, відповіді, редагування,
       видалення, реакції, закріплення, вкладені картинки, пошук
     • прямі повідомлення та друзі (запроси, блокування)
     • статуси онлайну (онлайн / зайнятий / не турбувати / невидимий)
     • голосові канали: сигналинг WebRTC через SSE (аудіо P2P між учасниками)
     • усе розповсюджується в реальному часі через Server-Sent Events

   Дані: data/db.json (+ data/uploads/ для картинок), запис із буферизацією.
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3001;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const DB_FILE = path.join(DATA, 'db.json');

const MAX_BODY = 16 * 1024 * 1024;  // 16 МБ — аватари/банери dataURL і картинки (з Nitro)
const MAX_MSG = 2000;               // ліміт повідомлення, як у Discord
const MSG_KEEP = 1000;              // скільки повідомлень лишаємо в каналі
const UPLOAD_MAX = 4 * 1024 * 1024; // ліміт однієї картинки

/* ------------------------------------------------------------------ сховище */

function blankDb() {
  return {
    users: {}, sessions: {}, servers: {}, dms: {}, msgs: {},
    requests: [], invites: {}, reads: {}
  };
}

let db = blankDb();

(function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) { db = blankDb(); }
  const base = blankDb();
  for (const k of Object.keys(base)) {
    if (db[k] === undefined || db[k] === null) db[k] = base[k];
  }
  Object.values(db.servers).forEach(normalizeServer);
})();

let saveTimer = null;
function saveDb(immediate) {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const write = function () {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) { console.error('db save:', e.message); }
  };
  if (immediate) write();
  else saveTimer = setTimeout(write, 400);
}

/* ------------------------------------------------------------- дрібниці */

function uid(prefix) {
  return (prefix || '') + crypto.randomBytes(6).toString('hex');
}

function escapeRx(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function str(v, max) {
  if (v === null || v === undefined) return '';
  return String(v).slice(0, max);
}

function err(code, msg) {
  const e = new Error(msg);
  e.status = code;
  return e;
}

function hashPass(pass, salt) {
  return crypto.scryptSync(String(pass), salt, 32).toString('hex');
}

const NAME_RX = /^[a-z0-9._а-яіїєґ'’ʼ\- ]{2,32}$/i;

/* користувачі ------------------------------------------------------------- */

function findUserByName(name) {
  const n = str(name, 32).toLowerCase();
  return Object.values(db.users).find(u => u.username.toLowerCase() === n) || null;
}

function pubUser(u) {
  return {
    id: u.id, username: u.username, displayName: u.displayName,
    avatar: u.avatar || null, accent: u.accent || '#5865f2',
    about: u.about || '', custom: u.custom || '', createdAt: u.createdAt,
    nitro: !!u.nitro, banner: u.banner || null, tag: u.tag || ''
  };
}

function meUser(u) {
  const p = pubUser(u);
  p.friends = u.friends.slice();
  p.blocked = u.blocked.slice();
  p.statusPref = u.statusPref || 'online';
  return p;
}

/* присутність (у пам'яті) -------------------------------------------------- */

const presence = new Map();   // uid -> { state, since, voice }

function getPresence(id) {
  return presence.get(id) || { state: 'offline', since: Date.now(), voice: null };
}

const clients = new Map();    // uid -> Set<res>
const aliveClients = new Set(); // вікна застосунку (навіть неавторизовані)

/* Автозупинка в режимі застосунку: коли всі вікна закрито — сервер виходить сам. */
const APP_MODE = process.argv.indexOf('--app') !== -1 || process.env.MESSENGER_APP === '1';
let appExitTimer = null;

function scheduleAppExit() {
  if (!APP_MODE || appExitTimer) return;
  appExitTimer = setTimeout(function () {
    appExitTimer = null;
    if (aliveClients.size === 0 && clients.size === 0) {
      console.log('Вікно застосунку закрито — зупиняю сервер.');
      process.exit(0);
    }
  }, 20000);
}

function cancelAppExit() {
  if (appExitTimer) { clearTimeout(appExitTimer); appExitTimer = null; }
}


function sseSend(res, type, data) {
  try { res.write('event: ' + type + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (e) {}
}

function toUser(id, type, data) {
  const set = clients.get(id);
  if (set) set.forEach(r => sseSend(r, type, data));
}

function broadcastAll(type, data) {
  for (const set of clients.values()) set.forEach(r => sseSend(r, type, data));
}

function audienceChannel(chanId) {
  const g = getChannel(chanId);
  if (!g) return [];
  if (g.kind === 'dm') return g.dm.parts.slice();
  return Object.keys(g.server.members);
}

function broadcastAudience(ids, type, data) {
  ids.forEach(id => toUser(id, type, data));
}

function voiceAudience(chanId) {
  const out = [];
  for (const [id, p] of presence) {
    if (p.voice && p.voice.channel === chanId) out.push(id);
  }
  return out;
}

function setPresence(id, patch) {
  const old = presence.get(id) || { state: 'offline', since: Date.now(), voice: null };
  const next = Object.assign({}, old, patch);
  if (patch.state && patch.state !== old.state) next.since = Date.now();
  presence.set(id, next);

  broadcastAll('presence', { userId: id, presence: next });

  const ov = JSON.stringify(old.voice || null);
  const nv = JSON.stringify(next.voice || null);
  const oldChan = (old.voice && old.voice.channel) || null;
  const newChan = (next.voice && next.voice.channel) || null;
  if (oldChan !== newChan) {
    if (old.voice) {
      broadcastAudience(voiceAudience(old.voice.channel).concat(audienceChannel(old.voice.channel)),
        'voice.leave', { channel: old.voice.channel, userId: id });
    }
    if (next.voice) {
      broadcastAudience(voiceAudience(next.voice.channel).concat(audienceChannel(next.voice.channel)),
        'voice.join', { channel: next.voice.channel, userId: id, voice: next.voice });
    }
  } else if (next.voice && ov !== nv) {
    broadcastAudience(voiceAudience(newChan).concat(audienceChannel(newChan)),
      'voice.state', { channel: newChan, userId: id, voice: next.voice });
  }
}

/* доступ ------------------------------------------------------------------ */

function isMember(s, id) { return !!(s && s.members && s.members[id]); }

function canManage(u, s) {
  if (!s || !u) return false;
  if (s.owner === u.id) return true;
  const m = s.members[u.id];
  if (!m) return false;
  return m.roles.some(rid => {
    const r = s.roles.find(x => x.id === rid);
    return r && r.manage;
  });
}

function getChannel(chanId) {
  if (!chanId) return null;
  const dm = db.dms[chanId];
  if (dm) return { kind: 'dm', dm: dm };
  for (const s of Object.values(db.servers)) {
    const c = s.channels.find(c => c.id === chanId);
    if (c) return { kind: 'server', server: s, channel: c };
  }
  return null;
}

function needRead(u, chanId) {
  const g = getChannel(chanId);
  if (!g) throw err(404, 'Канал не знайдено');
  if (g.kind === 'dm') {
    if (!g.dm.parts.includes(u.id)) throw err(403, 'Немає доступу');
    return g;
  }
  if (!isMember(g.server, u.id)) throw err(403, 'Немає доступу');
  if (g.channel.type === 'category') throw err(400, 'Це категорія');
  return g;
}

function needMember(u, serverId) {
  const s = db.servers[serverId];
  if (!s) throw err(404, 'Сервер не знайдено');
  if (!isMember(s, u.id)) throw err(403, 'Немає доступу');
  return s;
}

/* повідомлення ------------------------------------------------------------ */

function mentionsMe(u, m) {
  const c = m.content || '';
  if (/(^|\s)@everyone(\W|$)/i.test(c)) return true;
  const names = [u.username, u.displayName].filter(Boolean);
  for (const n of names) {
    if (n.length < 2) continue;
    if (new RegExp('(^|[^\\w])@' + escapeRx(n) + '(?!\\w)', 'i').test(c)) return true;
  }
  return false;
}

function sanitizeAttachments(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const a of list.slice(0, 4)) {
    if (!a || typeof a !== 'object') continue;
    const url = String(a.url || '');
    if (!/^\/uploads\/[a-z0-9._-]+$/i.test(url)) continue;
    out.push({ url: url, name: str(a.name, 100) || 'image' });
  }
  return out;
}

function makeMessage(chanId, u, body) {
  return {
    id: uid('m'),
    channel: chanId,
    author: u.id,
    content: str(body && body.content, MAX_MSG),
    at: Date.now(),
    edited: 0,
    replyTo: (body && body.replyTo) ? str(body.replyTo, 20) : null,
    attachments: sanitizeAttachments(body && body.attachments),
    reactions: {},
    pinned: false,
    nonce: (body && body.nonce) ? str(body.nonce, 20) : null
  };
}

function pushMsg(chanId, m) {
  const arr = db.msgs[chanId] || (db.msgs[chanId] = []);
  arr.push(m);
  if (arr.length > MSG_KEEP) arr.splice(0, arr.length - MSG_KEEP);
  saveDb();
}

function findMsg(chanId, mid) {
  const arr = db.msgs[chanId] || [];
  return arr.find(m => m.id === mid) || null;
}

/* непрочитане ------------------------------------------------------------- */

function readTs(u, chanId) {
  const r = db.reads[u.id] || (db.reads[u.id] = {});
  return r[chanId] || 0;
}

function unreadFor(u, chanId) {
  const arr = db.msgs[chanId] || [];
  const ts = readTs(u, chanId);
  let unread = 0, mention = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].at <= ts) break;
    unread++;
    if (mentionsMe(u, arr[i])) mention++;
  }
  return { unread: unread, mention: mention };
}

/* стан для клієнта -------------------------------------------------------- */

function serverView(s) {
  return JSON.parse(JSON.stringify(s));
}

/* ------------------------------------------------- бусти та теги сервера - */

/* гарантуємо поля бустів/тегів у старих серверах */
function normalizeServer(s) {
  if (!Array.isArray(s.boosts)) s.boosts = [];
  if (!Array.isArray(s.tags)) s.tags = [];
  if (typeof s.desc !== 'string') s.desc = '';
  if (typeof s.region !== 'string') s.region = 'europe';
  if (typeof s.verify !== 'number') s.verify = 0;
  if (typeof s.notify !== 'number') s.notify = 0;
  if (typeof s.filter !== 'number') s.filter = 0;
  if (typeof s.banner !== 'string') s.banner = '';
  return s;
}

/* рівень бустів: 1 → 1 буст, 2 → 7, 3 → 14 (як у Discord) */
function boostLevel(s) {
  const n = (s.boosts || []).length;
  if (n >= 14) return 3;
  if (n >= 7) return 2;
  if (n >= 1) return 1;
  return 0;
}
function boostNext(s) {
  const n = (s.boosts || []).length;
  if (n < 1) return 1;
  if (n < 7) return 7;
  if (n < 14) return 14;
  return 0;
}
function tagLimit(s) { return [2, 5, 10, 20][boostLevel(s)]; }
const PRESET_TAGS = ['Ігри', 'Музика', 'Освіта', 'Спорт', 'Технології', 'Розваги', 'Аніме',
  'Мистецтво', 'Кіно', 'Наука', 'Подорожі', 'Кулінарія', 'Природа', 'Фотографія',
  'Програмування', 'Обговорення', 'Спільнота', 'Меми', 'Кіберспорт', 'Хобі'];

function stateFor(u) {
  const users = {};
  const addU = function (id) {
    const x = db.users[id];
    if (x && !users[id]) users[id] = pubUser(x);
  };
  addU(u.id);

  const servers = [];
  const counts = {};
  const mentions = {};

  Object.values(db.servers).forEach(s => {
    if (!isMember(s, u.id)) return;
    servers.push(serverView(s));
    s.channels.forEach(c => {
      if (c.type === 'category') return;
      const r = unreadFor(u, c.id);
      counts[c.id] = r.unread;
      mentions[c.id] = r.mention;
    });
  });

  const requests = db.requests
    .filter(r => r.from === u.id || r.to === u.id)
    .map(r => ({ id: r.id, from: r.from, to: r.to, at: r.at }));
  requests.forEach(r => addU(r.from === u.id ? r.to : r.from));

  u.friends.forEach(addU);
  u.blocked.forEach(addU);

  const dms = Object.values(db.dms)
    .filter(d => d.parts.includes(u.id))
    .map(d => {
      const other = d.parts.find(p => p !== u.id);
      addU(other);
      const r = unreadFor(u, d.id);
      counts[d.id] = r.unread;
      mentions[d.id] = r.mention;
      return { id: d.id, with: other, at: d.at };
    })
    .sort((a, b) => b.at - a.at);

  const presences = {};
  Object.keys(users).forEach(id => { presences[id] = getPresence(id); });

  return {
    me: meUser(u), users: users, servers: servers, dms: dms,
    reads: db.reads[u.id] || {}, counts: counts, mentions: mentions,
    requests: requests, presences: presences
  };
}

/* ------------------------------------------------------------- маршрути */

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[A-Za-z_]+/g, function (m) {
    keys.push(m.slice(1));
    return '([^/]+)';
  }) + '$');
  routes.push({ method: method, rx: rx, keys: keys, handler: handler });
}

function bodyJson(ctx) {
  return ctx.body;
}

/* --- акаунти -------------------------------------------------------------- */

route('POST', '/api/register', function (ctx) {
  const b = bodyJson(ctx);
  const username = str(b.username, 32).trim();
  const displayName = str(b.displayName, 32).trim() || username;
  const password = String(b.password || '');
  if (!NAME_RX.test(username)) throw err(400, 'Ім’я: 2–32 символи. Дозволено літери (укр./англ.), цифри, пробіл та . _ - ’ \'');
  if (password.length < 4 || password.length > 64) throw err(400, 'Пароль: мінімум 4 символи, максимум 64');
  if (findUserByName(username)) throw err(409, 'Таке ім’я вже зайняте');

  const salt = crypto.randomBytes(16).toString('hex');
  const u = {
    id: uid('u'), username: username, displayName: displayName,
    salt: salt, pass: hashPass(password, salt),
    avatar: null, accent: '#5865f2', about: '', custom: '',
    nitro: false, banner: null, tag: '',
    statusPref: 'online', friends: [], blocked: [], createdAt: Date.now()
  };
  db.users[u.id] = u;
  const token = crypto.randomBytes(24).toString('base64url');
  db.sessions[token] = { uid: u.id, at: Date.now() };
  saveDb(true);
  return { token: token, me: meUser(u) };
});

route('POST', '/api/login', function (ctx) {
  const b = bodyJson(ctx);
  const u = findUserByName(b.username);
  if (!u) throw err(401, 'Невірне ім’я або пароль');
  if (hashPass(String(b.password || ''), u.salt) !== u.pass) throw err(401, 'Невірне ім’я або пароль');
  const token = crypto.randomBytes(24).toString('base64url');
  db.sessions[token] = { uid: u.id, at: Date.now() };
  saveDb();
  return { token: token, me: meUser(u) };
});

route('GET', '/api/state', function (ctx) {
  return stateFor(ctx.user);
});

route('PATCH', '/api/me', function (ctx) {
  const u = ctx.user;
  const b = bodyJson(ctx);
  let changed = false;

  if (b.displayName !== undefined) {
    const v = str(b.displayName, 32).trim();
    if (v.length < 2) throw err(400, 'Нік: мінімум 2 символи');
    u.displayName = v; changed = true;
  }
  if (b.username !== undefined) {
    const v = str(b.username, 32).trim();
    if (!NAME_RX.test(v)) throw err(400, 'Некоректне ім’я');
    const other = findUserByName(v);
    if (other && other.id !== u.id) throw err(409, 'Ім’я зайняте');
    u.username = v; changed = true;
  }
  if (b.avatar !== undefined) {
    const v = b.avatar === null ? null : String(b.avatar);
    const cap = u.nitro ? 4000000 : 500000;
    if (v && (v.length > cap || !/^data:image\//.test(v))) throw err(400, 'Забагато даних аватара');
    u.avatar = v; changed = true;
  }
  if (b.banner !== undefined) {
    const v = b.banner === null ? null : String(b.banner);
    if (v && (!u.nitro || v.length > 4000000 || !/^data:image\//.test(v)))
      throw err(400, 'Банер доступний лише з Nitro');
    u.banner = v; changed = true;
  }
  if (b.nitro !== undefined) {
    u.nitro = !!b.nitro;
    if (!u.nitro) u.banner = null;
    changed = true;
  }
  if (b.tag !== undefined) {
    u.tag = str(b.tag, 4).replace(/[^A-Za-z0-9]/g, '');
    changed = true;
  }
  if (b.accent !== undefined) {
    if (/^#[0-9a-f]{6}$/i.test(String(b.accent))) u.accent = String(b.accent);
    changed = true;
  }
  if (b.about !== undefined) { u.about = str(b.about, 190); changed = true; }
  if (b.custom !== undefined) { u.custom = str(b.custom, 100); changed = true; }
  if (b.statusPref !== undefined) {
    if (['online', 'idle', 'dnd', 'invisible'].includes(b.statusPref)) u.statusPref = b.statusPref;
    changed = true;
  }
  if (changed) {
    saveDb();
    broadcastAll('user.updated', { user: pubUser(u) });
    toUser(u.id, 'me.updated', { me: meUser(u) });
  }
  return { me: meUser(u) };
});

route('POST', '/api/upload', function (ctx) {
  const raw = ctx.raw;
  if (!raw || !raw.length) throw err(400, 'Порожній файл');
  const cap = ctx.user.nitro ? 10 * 1024 * 1024 : UPLOAD_MAX;
  if (raw.length > cap) throw err(413, 'Файл завеликий (до ' + Math.round(cap / 1048576) + ' МБ)');
  const ct = String(ctx.req.headers['content-type'] || '');
  const exts = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
  const ext = exts[ct];
  if (!ext) throw err(400, 'Лише картинки');
  fs.mkdirSync(UPLOADS, { recursive: true });
  const name = uid('i') + '.' + ext;
  fs.writeFileSync(path.join(UPLOADS, name), raw);
  return { url: '/uploads/' + name };
});

route('POST', '/api/presence', function (ctx) {
  const b = bodyJson(ctx);
  const st = ['online', 'idle', 'dnd', 'invisible'].includes(b.state) ? b.state : 'online';
  setPresence(ctx.user.id, { state: st });
  return { ok: true };
});

/* --- друзі ---------------------------------------------------------------- */

route('POST', '/api/friends', function (ctx) {
  const u = ctx.user;
  const target = findUserByName(bodyJson(ctx).username);
  if (!target) throw err(404, 'Користувача не знайдено');
  if (target.id === u.id) throw err(400, 'Це ви самі');
  if (u.friends.includes(target.id)) throw err(409, 'Ви вже друзі');

  const existing = db.requests.find(r =>
    (r.from === target.id && r.to === u.id) || (r.from === u.id && r.to === target.id));
  if (existing) {
    if (existing.from === target.id) {
      // він уже запросив мене — приймаємо одразу
      db.requests = db.requests.filter(r => r !== existing);
      u.friends.push(target.id);
      target.friends.push(u.id);
      saveDb();
      const payload = { user: pubUser(target) };
      toUser(u.id, 'friend.added', payload);
      toUser(target.id, 'friend.added', { user: pubUser(u) });
      toUser(target.id, 'request.resolved', { id: existing.id });
      return { accepted: true, user: pubUser(target) };
    }
    throw err(409, 'Запит уже надіслано');
  }

  const req = { id: uid('r'), from: u.id, to: target.id, at: Date.now() };
  db.requests.push(req);
  saveDb();
  toUser(target.id, 'request.created', { request: req, user: pubUser(u) });
  return { request: req };
});

route('POST', '/api/friends/:id/accept', function (ctx) {
  const u = ctx.user;
  const r = db.requests.find(x => x.id === ctx.params.id);
  if (!r || r.to !== u.id) throw err(404, 'Запит не знайдено');
  const other = db.users[r.from];
  db.requests = db.requests.filter(x => x !== r);
  if (other && !u.friends.includes(other.id)) {
    u.friends.push(other.id);
    other.friends.push(u.id);
  }
  saveDb();
  if (other) {
    toUser(other.id, 'friend.added', { user: pubUser(u) });
    toUser(other.id, 'request.resolved', { id: r.id });
  }
  toUser(u.id, 'request.resolved', { id: r.id });
  return { ok: true };
});

route('POST', '/api/friends/:id/decline', function (ctx) {
  const u = ctx.user;
  const r = db.requests.find(x => x.id === ctx.params.id);
  if (!r || (r.to !== u.id && r.from !== u.id)) throw err(404, 'Запит не знайдено');
  db.requests = db.requests.filter(x => x !== r);
  saveDb();
  toUser(r.from, 'request.resolved', { id: r.id });
  toUser(r.to, 'request.resolved', { id: r.id });
  return { ok: true };
});

route('DELETE', '/api/friends/:id', function (ctx) {
  const u = ctx.user;
  const other = db.users[ctx.params.id];
  u.friends = u.friends.filter(x => x !== ctx.params.id);
  if (other) other.friends = other.friends.filter(x => x !== u.id);
  saveDb();
  if (other) toUser(other.id, 'friend.removed', { userId: u.id });
  return { ok: true };
});

route('POST', '/api/blocks', function (ctx) {
  const u = ctx.user;
  const other = findUserByName(bodyJson(ctx).username);
  if (!other || other.id === u.id) throw err(404, 'Користувача не знайдено');
  if (!u.blocked.includes(other.id)) u.blocked.push(other.id);
  u.friends = u.friends.filter(x => x !== other.id);
  other.friends = other.friends.filter(x => x !== u.id);
  saveDb();
  return { ok: true };
});

route('DELETE', '/api/blocks/:id', function (ctx) {
  const u = ctx.user;
  u.blocked = u.blocked.filter(x => x !== ctx.params.id);
  saveDb();
  return { ok: true };
});

/* --- сервери -------------------------------------------------------------- */

function defaultChannels() {
  const catT = { id: uid('c'), name: 'ТЕКСТОВІ КАНАЛИ', type: 'category' };
  const catV = { id: uid('c'), name: 'ГОЛОСОВІ КАНАЛИ', type: 'category' };
  const t = { id: uid('c'), name: 'загальний', type: 'text', topic: '', cat: catT.id };
  const v = { id: uid('c'), name: 'Голосовий', type: 'voice', topic: '', cat: catV.id };
  return [catT, t, catV, v];
}

route('POST', '/api/servers', function (ctx) {
  const u = ctx.user;
  const b = bodyJson(ctx);
  const name = str(b.name, 100).trim();
  if (name.length < 2) throw err(400, 'Назва: мінімум 2 символи');

  const defRole = { id: uid('R'), name: '@everyone', color: '#dbdee1', manage: false, pos: 0 };
  const s = {
    id: uid('s'), name: name,
    icon: (b.icon && /^data:image\//.test(String(b.icon)) && String(b.icon).length < 200000)
      ? String(b.icon) : null,
    owner: u.id, channels: defaultChannels(),
    roles: [defRole],
    members: {}, createdAt: Date.now(),
    boosts: [], tags: [], desc: '', region: 'europe',
    verify: 0, notify: 0, filter: 0, banner: ''
  };
  s.members[u.id] = { roles: [defRole.id], joined: Date.now() };
  db.servers[s.id] = s;
  saveDb(true);
  toUser(u.id, 'server.joined', { server: serverView(s) });
  return { server: serverView(s) };
});

route('PATCH', '/api/servers/:id', function (ctx) {
  const u = ctx.user;
  const s = db.servers[ctx.params.id];
  if (!s) throw err(404, 'Сервер не знайдено');
  if (!canManage(u, s)) throw err(403, 'Немає прав');
  const b = bodyJson(ctx);
  if (b.name !== undefined) {
    const v = str(b.name, 100).trim();
    if (v.length < 2) throw err(400, 'Назва: мінімум 2 символи');
    s.name = v;
  }
  if (b.icon !== undefined) {
    s.icon = (b.icon && /^data:image\//.test(String(b.icon)) && String(b.icon).length < 200000)
      ? String(b.icon) : null;
  }
  if (b.desc !== undefined) s.desc = str(b.desc, 400);
  if (b.region !== undefined) s.region = ['auto', 'europe', 'usa', 'asia'].includes(b.region) ? b.region : 'europe';
  if (b.verify !== undefined) s.verify = Math.min(4, Math.max(0, Number(b.verify) || 0));
  if (b.notify !== undefined) s.notify = [0, 1].includes(Number(b.notify)) ? Number(b.notify) : s.notify;
  if (b.filter !== undefined) s.filter = [0, 1, 2].includes(Number(b.filter)) ? Number(b.filter) : s.filter;
  if (b.banner !== undefined) {
    s.banner = (b.banner && /^data:image\//.test(String(b.banner)) && String(b.banner).length < 300000)
      ? String(b.banner) : '';
  }
  saveDb();
  broadcastAudience(Object.keys(s.members), 'server.updated', { server: serverView(s) });
  return { server: serverView(s) };
});

route('DELETE', '/api/servers/:id', function (ctx) {
  const u = ctx.user;
  const s = db.servers[ctx.params.id];
  if (!s) throw err(404, 'Сервер не знайдено');
  if (s.owner !== u.id) throw err(403, 'Лише власник може видалити сервер');
  const members = Object.keys(s.members);
  s.channels.forEach(c => { delete db.msgs[c.id]; });
  delete db.servers[s.id];
  saveDb(true);
  broadcastAudience(members, 'server.deleted', { serverId: s.id });
  return { ok: true };
});

route('POST', '/api/servers/:id/channels', function (ctx) {
  const u = ctx.user;
  const s = db.servers[ctx.params.id];
  if (!s) throw err(404, 'Сервер не знайдено');
  if (!canManage(u, s)) throw err(403, 'Немає прав');

  const b = bodyJson(ctx);
  const type = ['text', 'voice', 'category'].includes(b.type) ? b.type : 'text';
  let name = str(b.name, 100).trim().replace(/\s+/g, type === 'category' ? ' ' : '-').toLowerCase();
  name = name.replace(/#/g, '');
  if (!name) throw err(400, 'Введіть назву');
  if (s.channels.some(c => c.name.toLowerCase() === name)) throw err(409, 'Канал з такою назвою вже є');

  const ch = { id: uid('c'), name: name, type: type, topic: '' };
  if (type !== 'category') {
    const catId = b.cat || (s.channels.find(c => c.type === 'category') || {}).id;
    if (catId) ch.cat = catId;
  }
  s.channels.push(ch);
  saveDb();
  broadcastAudience(Object.keys(s.members), 'server.updated', { server: serverView(s) });
  return { channel: ch };
});

route('PATCH', '/api/channels/:id', function (ctx) {
  const u = ctx.user;
  const g = getChannel(ctx.params.id);
  if (!g || g.kind !== 'server') throw err(404, 'Канал не знайдено');
  if (!canManage(u, g.server)) throw err(403, 'Немає прав');
  const b = bodyJson(ctx);
  if (b.name !== undefined) {
    let v = str(b.name, 100).trim().replace(/\s+/g, '-').toLowerCase().replace(/#/g, '');
    if (!v) throw err(400, 'Введіть назву');
    g.channel.name = v;
  }
  if (b.topic !== undefined) g.channel.topic = str(b.topic, 1024);
  saveDb();
  broadcastAudience(Object.keys(g.server.members), 'server.updated', { server: serverView(g.server) });
  return { ok: true };
});

route('DELETE', '/api/channels/:id', function (ctx) {
  const u = ctx.user;
  const g = getChannel(ctx.params.id);
  if (!g || g.kind !== 'server') throw err(404, 'Канал не знайдено');
  if (!canManage(u, g.server)) throw err(403, 'Немає прав');
  g.server.channels = g.server.channels.filter(c => c.id !== g.channel.id);
  delete db.msgs[g.channel.id];
  saveDb();
  broadcastAudience(Object.keys(g.server.members), 'server.updated', { server: serverView(g.server) });
  return { ok: true };
});

/* ролі */

route('POST', '/api/servers/:id/roles', function (ctx) {
  const u = ctx.user;
  const s = db.servers[ctx.params.id];
  if (!s) throw err(404, 'Сервер не знайдено');
  if (!canManage(u, s)) throw err(403, 'Немає прав');
  const b = bodyJson(ctx);
  const name = str(b.name, 32).trim();
  if (name.length < 2) throw err(400, 'Назва ролі: мінімум 2 символи');
  const role = {
    id: uid('R'), name: name,
    color: /^#[0-9a-f]{6}$/i.test(String(b.color)) ? String(b.color) : '#5865f2',
    manage: !!b.manage, pos: s.roles.length
  };
  s.roles.push(role);
  saveDb();
  broadcastAudience(Object.keys(s.members), 'server.updated', { server: serverView(s) });
  return { role: role };
});

route('PATCH', '/api/servers/:id/roles/:rid', function (ctx) {
  const u = ctx.user;
  const s = db.servers[ctx.params.id];
  if (!s) throw err(404, 'Сервер не знайдено');
  if (s.owner !== u.id) throw err(403, 'Лише власник редагує ролі');
  const r = s.roles.find(x => x.id === ctx.params.rid);
  if (!r) throw err(404, 'Роль не знайдено');
  const b = bodyJson(ctx);
  if (b.name !== undefined) r.name = str(b.name, 32).trim() || r.name;
  if (b.color !== undefined && /^#[0-9a-f]{6}$/i.test(String(b.color))) r.color = String(b.color);
  if (b.manage !== undefined) r.manage = !!b.manage;
  saveDb();
  broadcastAudience(Object.keys(s.members), 'server.updated', { server: serverView(s) });
  return { role: r };
});

route('DELETE', '/api/servers/:id/roles/:rid', function (ctx) {
  const u = ctx.user;
  const s = db.servers[ctx.params.id];
  if (!s) throw err(404, 'Сервер не знайдено');
  if (s.owner !== u.id) throw err(403, 'Лише власник редагує ролі');
  if (s.roles.length <= 1) throw err(400, 'Не можна видалити єдину роль');
  s.roles = s.roles.filter(r => r.id !== ctx.params.rid);
  Object.values(s.members).forEach(m => {
    m.roles = m.roles.filter(id => id !== ctx.params.rid);
  });
  saveDb();
  broadcastAudience(Object.keys(s.members), 'server.updated', { server: serverView(s) });
  return { ok: true };
});

route('POST', '/api/servers/:id/members/:uid/roles', function (ctx) {
  const u = ctx.user;
  const s = db.servers[ctx.params.id];
  if (!s) throw err(404, 'Сервер не знайдено');
  if (!canManage(u, s)) throw err(403, 'Немає прав');
  const m = s.members[ctx.params.uid];
  const role = s.roles.find(r => r.id === bodyJson(ctx).roleId);
  if (!m || !role) throw err(404, 'Не знайдено');
  if (m.roles.includes(role.id)) m.roles = m.roles.filter(x => x !== role.id);
  else m.roles.push(role.id);
  saveDb();
  broadcastAudience(Object.keys(s.members), 'server.updated', { server: serverView(s) });
  return { member: m };
});

/* бусти сервера (перемикач: буст/зняти буст) */

route('POST', '/api/servers/:id/boost', function (ctx) {
  const u = ctx.user;
  const s = db.servers[ctx.params.id];
  if (!s) throw err(404, 'Сервер не знайдено');
  if (!s.members[u.id]) throw err(403, 'Ти не учасник сервера');
  const i = s.boosts.findIndex(b => b.uid === u.id);
  const boosted = i < 0;
  if (boosted) s.boosts.push({ uid: u.id, at: Date.now() });
  else s.boosts.splice(i, 1);
  saveDb();
  broadcastAudience(Object.keys(s.members), 'server.updated', { server: serverView(s) });
  return { boosted: boosted, boosts: s.boosts.length, level: boostLevel(s) };
});

/* теги сервера */

route('POST', '/api/servers/:id/tags', function (ctx) {
  const u = ctx.user;
  const s = db.servers[ctx.params.id];
  if (!s) throw err(404, 'Сервер не знайдено');
  if (!s.members[u.id]) throw err(403, 'Ти не учасник сервера');
  const b = bodyJson(ctx);
  const name = str(b.name, 24).trim();
  if (!name) throw err(400, 'Введи назву тега');
  if (s.tags.some(t => t.name.toLowerCase() === name.toLowerCase())) throw err(409, 'Такий тег уже є');
  if (s.tags.length >= tagLimit(s)) throw err(400, 'Ліміт тегів для цього рівня бустів вичерпано');
  const custom = !!b.custom;
  if (custom && boostLevel(s) < 1) throw err(403, 'Власні теги відкриваються на 1 рівні бустів');
  if (!custom && !PRESET_TAGS.includes(name)) throw err(400, 'Недопустимий тег');
  const t = { id: uid('t'), name: name, custom: custom };
  s.tags.push(t);
  saveDb();
  broadcastAudience(Object.keys(s.members), 'server.updated', { server: serverView(s) });
  return { tag: t, count: s.tags.length, limit: tagLimit(s) };
});

route('DELETE', '/api/servers/:id/tags/:tid', function (ctx) {
  const u = ctx.user;
  const s = db.servers[ctx.params.id];
  if (!s) throw err(404, 'Сервер не знайдено');
  if (s.owner !== u.id && !canManage(u, s)) throw err(403, 'Немає прав');
  if (!s.tags.some(t => t.id === ctx.params.tid)) throw err(404, 'Тег не знайдено');
  s.tags = s.tags.filter(t => t.id !== ctx.params.tid);
  saveDb();
  broadcastAudience(Object.keys(s.members), 'server.updated', { server: serverView(s) });
  return { ok: true };
});

/* учасники */

route('DELETE', '/api/servers/:id/members/:uid', function (ctx) {
  const u = ctx.user;
  const s = db.servers[ctx.params.id];
  if (!s) throw err(404, 'Сервер не знайдено');
  const target = ctx.params.uid;
  if (target === s.owner) throw err(400, 'Не можна вигнати власника');
  if (u.id !== s.owner && !canManage(u, s)) throw err(403, 'Немає прав');
  if (!s.members[target]) throw err(404, 'Учасника не знайдено');
  delete s.members[target];
  saveDb();
  broadcastAudience(Object.keys(s.members), 'server.updated', { server: serverView(s) });
  toUser(target, 'server.deleted', { serverId: s.id });
  return { ok: true };
});

route('POST', '/api/servers/:id/leave', function (ctx) {
  const u = ctx.user;
  const s = db.servers[ctx.params.id];
  if (!s) throw err(404, 'Сервер не знайдено');
  if (s.owner === u.id) throw err(400, 'Власник не може вийти — видаліть сервер');
  if (!s.members[u.id]) throw err(400, 'Ви не учасник');
  delete s.members[u.id];
  saveDb();
  broadcastAudience(Object.keys(s.members), 'server.updated', { server: serverView(s) });
  toUser(u.id, 'server.deleted', { serverId: s.id });
  return { ok: true };
});

/* запрошення */

route('POST', '/api/servers/:id/invite', function (ctx) {
  const u = ctx.user;
  const s = db.servers[ctx.params.id];
  if (!s) throw err(404, 'Сервер не знайдено');
  if (!isMember(s, u.id)) throw err(403, 'Немає доступу');
  let code = Object.keys(db.invites).find(c => db.invites[c] === s.id);
  if (!code) {
    code = crypto.randomBytes(5).toString('base64url').replace(/[^a-z0-9]/gi, '').slice(0, 8);
    db.invites[code] = s.id;
    saveDb();
  }
  return { code: code };
});

route('POST', '/api/invites/:code', function (ctx) {
  const u = ctx.user;
  const sid = db.invites[ctx.params.code];
  const s = db.servers[sid];
  if (!s) throw err(404, 'Запрос недійсний');
  if (s.members[u.id]) return { server: serverView(s), already: true };
  const defRole = s.roles[0];
  s.members[u.id] = { roles: defRole ? [defRole.id] : [], joined: Date.now() };
  saveDb();
  broadcastAudience(Object.keys(s.members), 'server.updated', { server: serverView(s) });
  toUser(u.id, 'server.joined', { server: serverView(s) });
  return { server: serverView(s) };
});

/* --- ЛС ------------------------------------------------------------------ */

route('POST', '/api/dms', function (ctx) {
  const u = ctx.user;
  const other = db.users[str(bodyJson(ctx).userId, 20)];
  if (!other || other.id === u.id) throw err(404, 'Користувача не знайдено');

  let dm = Object.values(db.dms).find(d =>
    d.parts.includes(u.id) && d.parts.includes(other.id));
  if (!dm) {
    dm = { id: uid('d'), parts: [u.id, other.id], at: Date.now() };
    db.dms[dm.id] = dm;
    saveDb();
  }
  dm.at = Date.now();
  const view = { id: dm.id, with: other.id, at: dm.at };
  toUser(u.id, 'dm.created', { dm: view });
  toUser(other.id, 'dm.created', { dm: view, user: pubUser(u) });
  return { dm: view };
});

/* --- повідомлення -------------------------------------------------------- */

const rateMap = new Map();
function rateLimit(uidKey) {
  const now = Date.now();
  const arr = (rateMap.get(uidKey) || []).filter(t => now - t < 10000);
  if (arr.length > 30) throw err(429, 'Занадто багато повідомлень');
  arr.push(now);
  rateMap.set(uidKey, arr);
}

route('GET', '/api/channels/:id/messages', function (ctx) {
  const u = ctx.user;
  needRead(u, ctx.params.id);
  const arr = db.msgs[ctx.params.id] || [];
  const q = ctx.url.searchParams;
  const limit = Math.min(Number(q.get('limit')) || 50, 100);
  let out;

  const around = q.get('around');
  if (around) {
    const i = arr.findIndex(m => m.id === around);
    if (i < 0) out = arr.slice(-limit);
    else {
      const from = Math.max(0, i - Math.floor(limit / 2));
      out = arr.slice(from, from + limit);
    }
  } else {
    const before = q.get('before');
    let end = arr.length;
    if (before) {
      const i = arr.findIndex(m => m.id === before);
      if (i >= 0) end = i;
    }
    const after = q.get('after');
    let start = 0;
    if (after) {
      const i = arr.findIndex(m => m.id === after);
      if (i >= 0) start = i + 1;
      out = arr.slice(start);
    } else {
      out = arr.slice(Math.max(0, end - limit), end);
    }
  }
  return { messages: out, users: collectUsers(out) };
});

route('POST', '/api/channels/:id/messages', function (ctx) {
  const u = ctx.user;
  needRead(u, ctx.params.id);
  rateLimit(u.id);
  const b = bodyJson(ctx);
  const maxLen = u.nitro ? 4000 : MAX_MSG;
  const content = str(b.content, maxLen);
  const atts = sanitizeAttachments(b.attachments);
  if (!content.trim() && !atts.length) throw err(400, 'Порожнє повідомлення');

  const m = makeMessage(ctx.params.id, u, b);
  m.content = content;
  pushMsg(ctx.params.id, m);

  const payload = { channel: ctx.params.id, message: m, user: pubUser(u) };
  broadcastAudience(audienceChannel(ctx.params.id), 'message.created', payload);
  return { message: m };
});

function collectUsers(msgs) {
  const ids = new Set();
  msgs.forEach(m => {
    ids.add(m.author);
    if (m.replyTo) {
      const r = (db.msgs[m.channel] || []).find(x => x.id === m.replyTo);
      if (r) ids.add(r.author);
    }
  });
  const out = [];
  ids.forEach(id => { if (db.users[id]) out.push(pubUser(db.users[id])); });
  return out;
}

route('PATCH', '/api/channels/:id/messages/:mid', function (ctx) {
  const u = ctx.user;
  needRead(u, ctx.params.id);
  const m = findMsg(ctx.params.id, ctx.params.mid);
  if (!m) throw err(404, 'Повідомлення не знайдено');
  if (m.author !== u.id) throw err(403, 'Можна редагувати лише своє');
  m.content = str(bodyJson(ctx).content, MAX_MSG);
  m.edited = Date.now();
  saveDb();
  broadcastAudience(audienceChannel(ctx.params.id), 'message.updated',
    { channel: ctx.params.id, message: m });
  return { message: m };
});

route('DELETE', '/api/channels/:id/messages/:mid', function (ctx) {
  const u = ctx.user;
  const g = needRead(u, ctx.params.id);
  const m = findMsg(ctx.params.id, ctx.params.mid);
  if (!m) throw err(404, 'Повідомлення не знайдено');
  const canDelete = m.author === u.id ||
    (g.kind === 'server' && canManage(u, g.server));
  if (!canDelete) throw err(403, 'Немає прав');
  db.msgs[ctx.params.id] = (db.msgs[ctx.params.id] || []).filter(x => x.id !== m.id);
  saveDb();
  broadcastAudience(audienceChannel(ctx.params.id), 'message.deleted',
    { channel: ctx.params.id, id: m.id });
  return { ok: true };
});

route('POST', '/api/channels/:id/messages/:mid/reactions', function (ctx) {
  const u = ctx.user;
  needRead(u, ctx.params.id);
  const m = findMsg(ctx.params.id, ctx.params.mid);
  if (!m) throw err(404, 'Повідомлення не знайдено');
  const emoji = str(bodyJson(ctx).emoji, 16).trim();
  if (!emoji) throw err(400, 'Немає емодзі');
  const list = m.reactions[emoji] || [];
  const i = list.indexOf(u.id);
  if (i >= 0) {
    list.splice(i, 1);
    if (!list.length) delete m.reactions[emoji];
    else m.reactions[emoji] = list;
  } else {
    list.push(u.id);
    m.reactions[emoji] = list;
  }
  saveDb();
  broadcastAudience(audienceChannel(ctx.params.id), 'reaction.updated',
    { channel: ctx.params.id, id: m.id, reactions: m.reactions });
  return { reactions: m.reactions };
});

route('POST', '/api/channels/:id/messages/:mid/pin', function (ctx) {
  const u = ctx.user;
  needRead(u, ctx.params.id);
  const m = findMsg(ctx.params.id, ctx.params.mid);
  if (!m) throw err(404, 'Повідомлення не знайдено');
  m.pinned = !m.pinned;
  saveDb();
  broadcastAudience(audienceChannel(ctx.params.id), 'message.updated',
    { channel: ctx.params.id, message: m });
  return { pinned: m.pinned };
});

route('GET', '/api/channels/:id/pins', function (ctx) {
  needRead(ctx.user, ctx.params.id);
  const arr = (db.msgs[ctx.params.id] || []).filter(m => m.pinned);
  return { messages: arr, users: collectUsers(arr) };
});

route('POST', '/api/channels/:id/read', function (ctx) {
  const u = ctx.user;
  needRead(u, ctx.params.id);
  const r = db.reads[u.id] || (db.reads[u.id] = {});
  r[ctx.params.id] = Date.now();
  saveDb();
  return { ok: true };
});

route('POST', '/api/channels/:id/typing', function (ctx) {
  const u = ctx.user;
  needRead(u, ctx.params.id);
  broadcastAudience(audienceChannel(ctx.params.id).filter(x => x !== u.id),
    'typing', { channel: ctx.params.id, userId: u.id, until: Date.now() + 7000 });
  return { ok: true };
});

/* --- пошук --------------------------------------------------------------- */

route('GET', '/api/search', function (ctx) {
  const u = ctx.user;
  const q = str(ctx.url.searchParams.get('q'), 100).trim().toLowerCase();
  if (!q) throw err(400, 'Введіть запит');
  const serverId = ctx.url.searchParams.get('server');
  const dmId = ctx.url.searchParams.get('dm');

  let channels = [];
  if (serverId) {
    const s = db.servers[serverId];
    if (!s || !isMember(s, u.id)) throw err(403, 'Немає доступу');
    channels = s.channels.filter(c => c.type !== 'category').map(c => c.id);
  } else if (dmId) {
    needRead(u, dmId);
    channels = [dmId];
  } else {
    channels = Object.values(db.dms)
      .filter(d => d.parts.includes(u.id)).map(d => d.id);
    Object.values(db.servers).forEach(s => {
      if (isMember(s, u.id)) s.channels.forEach(c => {
        if (c.type !== 'category') channels.push(c.id);
      });
    });
  }

  const hits = [];
  for (const ch of channels) {
    const arr = db.msgs[ch] || [];
    for (let i = arr.length - 1; i >= 0 && hits.length < 60; i--) {
      const m = arr[i];
      const text = (m.content || '').toLowerCase();
      const name = (db.users[m.author] || {}).username || '';
      if (text.includes(q) || name.toLowerCase().includes(q)) hits.push(m);
    }
    if (hits.length >= 60) break;
  }
  hits.sort((a, b) => b.at - a.at);
  return { messages: hits.slice(0, 50), users: collectUsers(hits) };
});

/* --- голос ---------------------------------------------------------------- */

route('POST', '/api/voice', function (ctx) {
  const u = ctx.user;
  const b = bodyJson(ctx);
  const chanId = str(b.channel, 20);
  if (b.action === 'leave') {
    setPresence(u.id, { voice: null });
    return { ok: true };
  }
  needRead(u, chanId);
  const g = getChannel(chanId);
  const serverId = g.kind === 'server' ? g.server.id : null;
  setPresence(u.id, { voice: { channel: chanId, serverId: serverId } });
  const peers = voiceAudience(chanId).filter(x => x !== u.id);
  return { peers: peers };
});

route('POST', '/api/voice/signal', function (ctx) {
  const to = str(bodyJson(ctx).to, 20);
  const data = bodyJson(ctx).data;
  if (!to || !data) throw err(400, 'Немає даних');
  toUser(to, 'voice.signal', { from: ctx.user.id, data: data });
  return { ok: true };
});

route('POST', '/api/voice/state', function (ctx) {
  const u = ctx.user;
  const b = bodyJson(ctx);
  const p = presence.get(u.id);
  if (!p || !p.voice) return { ok: true };
  const voice = Object.assign({}, p.voice);
  if (typeof b.share === 'boolean') voice.share = b.share;
  if (typeof b.cam === 'boolean') voice.cam = b.cam;
  setPresence(u.id, { voice: voice });
  return { ok: true };
});

/* ------------------------------------------------------------ HTTP */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8'
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function serveFile(res, file) {
  fs.readFile(file, function (e, buf) {
    if (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': (ext === '.html' || ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=300'
    });
    res.end(buf);
  });
}

function authUser(req, url) {
  let token = '';
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) token = h.slice(7);
  if (!token) token = url.searchParams.get('token') || '';
  if (!token) return null;
  const s = db.sessions[token];
  if (!s) return null;
  const u = db.users[s.uid];
  return u || null;
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on('data', function (c) {
      size += c.length;
      if (size > MAX_BODY) { reject(err(413, 'Забагато даних')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function handleAlive(ctx) {
  const res = ctx.res;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 3000\n\n');
  res.write(': alive\n\n');
  aliveClients.add(res);
  cancelAppExit();
  const ping = setInterval(function () { try { res.write(': ping\n\n'); } catch (e) {} }, 15000);
  ctx.req.on('close', function () {
    clearInterval(ping);
    aliveClients.delete(res);
    scheduleAppExit();
  });
}

function handleEvents(ctx) {
  const res = ctx.res;
  const u = ctx.user;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 2000\n\n');

  if (!clients.has(u.id)) clients.set(u.id, new Set());
  clients.get(u.id).add(res);
  cancelAppExit();

  const p = getPresence(u.id);
  if (p.state === 'offline' || p.state === 'invisible') setPresence(u.id, { state: 'online' });
  else broadcastAll('presence', { userId: u.id, presence: p });

  sseSend(res, 'hello', { at: Date.now() });

  const ping = setInterval(function () {
    try { res.write(': ping\n\n'); } catch (e) {}
  }, 15000);

  ctx.req.on('close', function () {
    clearInterval(ping);
    const set = clients.get(u.id);
    if (set) {
      set.delete(res);
      if (!set.size) clients.delete(u.id);
    }
    if (!clients.has(u.id)) setPresence(u.id, { state: 'offline', voice: null });
    scheduleAppExit();
  });
}

const server = http.createServer(async function (req, res) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) {
    res.writeHead(400); res.end(); return;
  }
  const p = decodeURIComponent(url.pathname);

  try {
    /* API */
    if (p === '/api/alive') return handleAlive({ req: req, res: res });

    if (p === '/api/events') {
      const user = authUser(req, url);
      if (!user) return json(res, 401, { error: 'Не авторизовано' });
      return handleEvents({ req: req, res: res, user: user, url: url });
    }

    if (p.startsWith('/api/')) {
      const user = authUser(req, url);
      const needsAuth = p !== '/api/register' && p !== '/api/login';
      if (needsAuth && !user) return json(res, 401, { error: 'Не авторизовано' });

      let raw = Buffer.alloc(0);
      let body = {};
      if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') {
        raw = await readBody(req);
        if (raw.length && !String(req.headers['content-type'] || '').startsWith('image/')) {
          try { body = JSON.parse(raw.toString('utf8')); }
          catch (e) { return json(res, 400, { error: 'Некоректний JSON' }); }
        }
      }

      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = p.match(r.rx);
        if (!m) continue;
        const params = {};
        r.keys.forEach((k, i) => { params[k] = m[i + 1]; });
        try {
          const out = r.handler({ req: req, res: res, user: user, url: url, params: params, body: body, raw: raw });
          if (out && typeof out.then === 'function') return json(res, 200, await out);
          return json(res, 200, out === undefined ? { ok: true } : out);
        } catch (e) {
          const code = e.status || 500;
          if (code === 500) console.error(e);
          return json(res, code, { error: e.message || 'Помилка' });
        }
      }
      return json(res, 404, { error: 'Невідомий маршрут' });
    }

    /* картинки користувачів */
    if (p.startsWith('/uploads/')) {
      const name = path.basename(p);
      const file = path.join(UPLOADS, name);
      if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
      return serveFile(res, file);
    }

    /* статика + SPA fallback */
    let file = path.normalize(path.join(PUB, p));
    if (!file.startsWith(PUB)) { res.writeHead(403); res.end(); return; }
    if (p === '/' || !path.extname(p)) file = path.join(PUB, 'index.html');
    return serveFile(res, file);
  } catch (e) {
    if (!res.headersSent) json(res, e.status || 500, { error: e.message || 'Помилка' });
    else res.end();
  }
});

server.listen(PORT, function () {
  console.log('Месенджер: http://localhost:' + PORT);
  if (APP_MODE) {
    console.log('Режим застосунку: сервер зупиниться, коли закриється вікно.');
    /* якщо вікно так і не під'єдналося — прибираємо «осиротілий» процес */
    const watchdog = setTimeout(function () {
      if (aliveClients.size === 0 && clients.size === 0) {
        console.log('Вікно застосунку не під’єдналося — зупиняю сервер.');
        process.exit(0);
      }
    }, 90000);
    if (watchdog.unref) watchdog.unref();
  }
});
