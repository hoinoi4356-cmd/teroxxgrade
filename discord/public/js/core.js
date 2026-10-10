/* core.js — стан, API, реальний час (SSE), роутер, статуси */
'use strict';

const S = {
  token: localStorage.getItem('dc_token') || '',
  me: null,
  users: {},
  servers: [],
  dms: [],
  reads: {},
  counts: {},
  mentions: {},
  requests: [],
  presences: {},
  view: { type: 'home' },
  lastChannel: {},          // serverId -> channelId
  cache: {},                // chanId -> { messages:[], users:{}, done:bool }
  typing: {},               // chanId -> { userId: until }
  es: null,
  alive: null,
  wasDown: false,
  nitro: false
};

/* --------------------------------------------------------------- API ---- */

async function api(method, path, body, raw) {
  const headers = {};
  if (S.token) headers['Authorization'] = 'Bearer ' + S.token;
  let payload = null;
  if (raw) {
    headers['Content-Type'] = raw.type;
    payload = raw.body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, { method: method, headers: headers, body: payload });
  let data = null;
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok) {
    if (res.status === 401) { logout(); }
    const e = new Error((data && data.error) || ('Помилка ' + res.status));
    e.status = res.status;
    throw e;
  }
  return data || {};
}

function saveToken(t) { S.token = t; localStorage.setItem('dc_token', t); }

function logout() {
  localStorage.removeItem('dc_token');
  S.token = '';
  S.me = null;
  if (S.es) { try { S.es.close(); } catch (e) {} S.es = null; }
  location.hash = '';
  renderAuth();
}

/* ----------------------------------------------------------- реальний час */

const EVT = {};

function on(type, fn) { (EVT[type] = EVT[type] || []).push(fn); }

function connectEvents() {
  if (S.es) { try { S.es.close(); } catch (e) {} }
  let es;
  try { es = new EventSource('/api/events?token=' + encodeURIComponent(S.token)); }
  catch (e) { return; }
  S.es = es;

  const types = ['hello', 'presence', 'user.updated', 'me.updated', 'message.created',
    'message.updated', 'message.deleted', 'reaction.updated', 'typing', 'server.updated',
    'server.deleted', 'server.joined', 'dm.created', 'request.created', 'request.resolved',
    'friend.added', 'friend.removed', 'voice.join', 'voice.leave', 'voice.signal'];

  types.forEach(function (t) {
    es.addEventListener(t, function (e) {
      let data = {};
      try { data = JSON.parse(e.data); } catch (err) { return; }
      if (t === 'hello') {
        if (S.wasDown) { S.wasDown = false; resync(); }
        return;
      }
      (EVT[t] || []).forEach(fn => { try { fn(data); } catch (err) { console.error(t, err); } });
    });
  });

  es.onerror = function () {
    if (es.readyState === EventSource.CLOSED || es.readyState === EventSource.CONNECTING) S.wasDown = true;
  };
}

/* «пульс» вікна застосунку: сервер у режимі застосунку зупиняється, коли всі вікна закриті */
function startAlive() {
  if (S.alive) return;
  try { S.alive = new EventSource('/api/alive'); } catch (e) { /* ignore */ }
}

async function resync() {
  try {
    const st = await api('GET', '/state');
    hydrate(st);
    renderApp();
    if (S.view.channelId && S.cache[S.view.channelId]) openChannel(S.view.channelId, true);
  } catch (e) { /* ignore */ }
}

function hydrate(st) {
  S.me = st.me;
  S.users = st.users || {};
  S.servers = st.servers || [];
  S.dms = st.dms || [];
  S.reads = st.reads || {};
  S.counts = st.counts || {};
  S.mentions = st.mentions || {};
  S.requests = st.requests || [];
  S.presences = st.presences || {};
  S.nitro = !!(S.me && S.me.nitro);
}

/* ------------------------------------------------------- статус онлайну - */

let idleTimer = null;

function pushPresence() {
  if (!S.me) return;
  const state = document.hidden || document.hasFocus && !document.hasFocus()
    ? 'idle' : (S.me.statusPref || 'online');
  api('POST', '/presence', { state: state }).catch(function () {});
}

function armIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(function () {
    api('POST', '/presence', { state: 'idle' }).catch(function () {});
  }, 5 * 60 * 1000);
}

window.addEventListener('focus', function () { pushPresence(); armIdle(); });
window.addEventListener('blur', function () { armIdle(); });

/* ----------------------------------------------------------- непрочитане */

function readMark(chanId) {
  if (!chanId || !S.me) return;
  S.reads[chanId] = Date.now();
  S.counts[chanId] = 0;
  S.mentions[chanId] = 0;
  api('POST', '/channels/' + chanId + '/read', {}).catch(function () {});
  renderRail();
  renderSidebar();
}

function curChannel() { return S.view.channelId || null; }

function isViewing(chanId) {
  return curChannel() === chanId && !document.hidden;
}

/* ------------------------------------------------------------- роутер ---- */

function navigate(hash) { location.hash = hash; }

function applyRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/');
  /* channels/@me | channels/@me/friends | channels/@me/<dm> | channels/<srv>/<ch> */
  if (parts[0] !== 'channels') { navigate('#/channels/@me'); return; }
  if (parts[1] === '@me') {
    if (parts[2] === 'friends') {
      S.view = { type: 'friends' };
    } else if (parts[2]) {
      const dm = S.dms.find(d => d.id === parts[2]);
      if (dm) { S.view = { type: 'dm', channelId: dm.id, dmId: dm.id }; }
      else { navigate('#/channels/@me'); return; }
    } else {
      S.view = { type: 'home' };
    }
  } else {
    const srv = S.servers.find(s => s.id === parts[1]);
    if (!srv) { navigate('#/channels/@me'); return; }
    let chId = parts[2];
    let ch = srv.channels.find(c => c.id === chId && c.type !== 'category');
    if (!ch) {
      ch = srv.channels.find(c => c.type === 'text') ||
        srv.channels.find(c => c.type === 'voice') ||
        srv.channels.find(c => c.type !== 'category');
    }
    if (!ch) { S.view = { type: 'server', serverId: srv.id, channelId: null, server: srv }; }
    else {
      S.view = { type: 'server', serverId: srv.id, channelId: ch.id, server: srv };
      S.lastChannel[srv.id] = ch.id;
    }
  }
  renderApp();
}

window.addEventListener('hashchange', function () { applyRoute(); });

/* --------------------------------------------------------------- сповіщення */

function notifyDesktop(title, body) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    new Notification(title, { body: body, icon: undefined });
  } catch (e) {}
}

function onMessageIncoming(payload) {
  const m = payload.message;
  const chanId = payload.channel;
  if (payload.user) S.users[payload.user.id] = payload.user;

  /* кеш */
  if (S.cache[chanId]) {
    const c = S.cache[chanId];
    if (!c.messages.some(x => x.id === m.id)) c.messages.push(m);
  }

  if (isViewing(chanId)) {
    readMark(chanId);
    appendMessageDom(chanId, m);
  } else if (m.author !== S.me.id) {
    S.counts[chanId] = (S.counts[chanId] || 0) + 1;
    const mention = /@everyone|@here/i.test(m.content) ||
      new RegExp('@' + S.me.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(m.content) ||
      new RegExp('@' + (S.me.displayName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(m.content);
    if (mention) S.mentions[chanId] = (S.mentions[chanId] || 0) + 1;

    const author = S.users[m.author];
    const dm = S.dms.find(d => d.id === chanId);
    let title = author ? (author.displayName || author.username) : 'Повідомлення';
    if (arenaName(chanId)) title += ' • #' + arenaName(chanId);
    playSound(mention ? 'mention' : 'notification');
    if (document.hidden) notifyDesktop(title, m.content || 'Вкладення');
  }
  renderRail();
  renderSidebar();
}

/* ------------------------------------------------------------- службове -- */

function arenaName(chanId) {
  for (const s of S.servers) {
    const c = s.channels.find(c => c.id === chanId);
    if (c) return c.name;
  }
  return null;
}

function userById(id) { return S.users[id] || null; }

function serverById(id) { return S.servers.find(s => s.id === id) || null; }
