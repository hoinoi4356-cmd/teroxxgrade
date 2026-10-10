/* views.js — сервери, канали, учасники, друзі, профілі, налаштування, вхід */
'use strict';

/* ================================================================ запуск */

async function boot() {
  startAlive();
  if (!S.token) { renderAuth(); return; }
  try {
    const st = await api('GET', '/state');
    hydrate(st);
    connectEvents();
    armIdle();
    if (!location.hash || location.hash === '#') navigate('#/channels/@me');
    else applyRoute();
  } catch (e) {
    S.token = '';
    localStorage.removeItem('dc_token');
    renderAuth();
  }
}
document.addEventListener('DOMContentLoaded', boot);

/* ================================================================ каркас */

function renderApp() {
  if (!S.me) { renderAuth(); return; }
  $('#boot').classList.add('hidden');
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  ensureSkeleton();
  if (typeof applyBg === 'function') applyBg(currentBg());
  if (typeof setVoiceFull === 'function') setVoiceFull(false);
  renderRail();
  renderSidebar();

  if (S.view.type === 'friends') {
    const mem = $('#members'); if (mem) mem.classList.add('hidden');
    renderFriends();
  } else if (S.view.channelId) {
    const mem = $('#members'); if (mem) mem.classList.remove('hidden');
    openChannel(S.view.channelId, true);
    renderMembers();
  } else {
    $('#chat-header').innerHTML = '';
    $('#chat-col').innerHTML = '<div class="empty-state">Обери канал ліворуч</div>';
    $('#composer') && ($('#composer').innerHTML = '');
  }
}

function ensureSkeleton() {
  if ($('#main-cols')) return;
  $('#main').innerHTML =
    '<header id="chat-header"></header>' +
    '<div id="main-cols">' +
    '<section id="chat-col"></section>' +
    '<aside id="members"></aside>' +
    '<aside id="search-panel" class="hidden"></aside>' +
    '</div>';
}

/* ================================================================ рейка */

function renderRail() {
  const rail = $('#rail');
  if (!rail) return;
  let html = '';

  const homeActive = S.view.type === 'home' || S.view.type === 'friends' || S.view.type === 'dm';
  let homeBadge = 0;
  S.dms.forEach(d => { homeBadge += S.mentions[d.id] || 0; });
  html += '<button class="rail-btn ' + (homeActive ? 'active' : '') + '" data-home="1" title="Повідомлення">' +
    '<span class="rail-icon">' + icon('logo', 28) + '</span>' +
    (homeBadge ? '<span class="rail-badge">' + homeBadge + '</span>' : '') + '</button>';
  html += '<div class="rail-sep"></div>';

  S.servers.forEach(function (s) {
    const active = S.view.type === 'server' && S.view.serverId === s.id;
    let unread = 0, mention = 0;
    s.channels.forEach(c => { unread += S.counts[c.id] || 0; mention += S.mentions[c.id] || 0; });
    const pill = active || unread ? '<span class="rail-pill ' + (active ? 'full' : '') + '"></span>' : '';
    const ic = s.icon ? '<img src="' + s.icon + '" alt="">' : esc(initials(s.name));
    html += '<button class="rail-btn ' + (active ? 'active' : '') + '" data-server="' + s.id + '" title="' + esc(s.name) + '">' +
      pill + '<span class="rail-icon">' + ic + '</span>' +
      (mention ? '<span class="rail-badge">' + mention + '</span>' : '') + '</button>';
  });

  html += '<button class="rail-btn add" data-add-server="1" title="Додати сервер"><span class="rail-icon">' + icon('plus', 26) + '</span></button>';
  html += '<button class="rail-btn" data-explore="1" title="Огляд серверів"><span class="rail-icon">' + icon('compass', 24) + '</span></button>';

  rail.innerHTML = html;

  $$('.rail-btn').forEach(function (b) {
    b.onclick = function (e) {
      if (b.dataset.home) navigate('#/channels/@me');
      else if (b.dataset.server) {
        const s = serverById(b.dataset.server);
        const ch = S.lastChannel[s.id] || (s.channels.find(c => c.type === 'text') || {}).id ||
          (s.channels.find(c => c.type !== 'category') || {}).id;
        navigate(ch ? '#/channels/' + s.id + '/' + ch : '#/channels/' + s.id);
      } else if (b.dataset.addServer) openAddServer();
      else if (b.dataset.explore) openAddServer();
    };
    b.oncontextmenu = function (e) {
      if (!b.dataset.server) return;
      e.preventDefault();
      const s = serverById(b.dataset.server);
      serverMenu(s, e.clientX, e.clientY);
    };
  });
}

function serverMenu(s, x, y) {
  const mine = s.owner === S.me.id;
  const canMan = canManageServer(s);
  const items = [
    { label: 'Позначити як прочитане', action: function () { s.channels.forEach(c => readMark(c.id)); } },
    { label: 'Запросити людей', icon: 'userPlus', action: function () { openInvite(s); } }
  ];
  if (canMan) items.push({ label: 'Налаштування сервера', icon: 'settings', action: function () { openServerSettings(s); } });
  items.push({ separator: true });
  if (mine) items.push({ label: 'Видалити сервер', icon: 'trash', danger: true, action: function () {
    confirmBox('Видалити сервер', 'Сервер «' + s.name + '» буде видалено назавжди.', async function () {
      try { await api('DELETE', '/servers/' + s.id, {}); } catch (e) { toast(e.message, 'err'); }
    });
  } });
  else items.push({ label: 'Вийти з сервера', icon: 'logout', danger: true, action: async function () {
    try { await api('POST', '/servers/' + s.id + '/leave', {}); } catch (e) { toast(e.message, 'err'); }
  } });
  contextMenu(x, y, items);
}

function canManageServer(s) {
  if (!s) return false;
  if (s.owner === S.me.id) return true;
  const m = s.members[S.me.id];
  return m && m.roles.some(rid => { const r = s.roles.find(x => x.id === rid); return r && r.manage; });
}

/* ============================================================ бічна панель */

function renderSidebar() {
  const sb = $('#sidebar');
  if (!sb) return;
  if (S.view.type === 'server' && S.view.serverId) renderServerSidebar(sb, serverById(S.view.serverId));
  else renderHomeSidebar(sb);
}

function renderServerSidebar(sb, s) {
  if (!s) { renderHomeSidebar(sb); return; }
  const cats = s.channels.filter(c => c.type === 'category');
  const hasUncat = s.channels.some(c => c.type !== 'category' && !cats.some(k => k.id === c.cat));

  let ch = '';
  s.channels.filter(c => c.type !== 'category' && !cats.some(k => k.id === c.cat)).forEach(c => { ch += channelItem(s, c); });
  cats.forEach(function (cat) {
    const collapsed = S._collapsed && S._collapsed[cat.id];
    ch += '<div class="cat-row" data-cat="' + cat.id + '">' +
      '<span class="cat-chev ' + (collapsed ? 'col' : '') + '">' + icon('chevronDown', 12) + '</span>' +
      '<span class="cat-name">' + esc(cat.name) + '</span>' +
      (canManageServer(s) ? '<button class="cat-add" data-newchan="' + cat.id + '" title="Створити канал">' + icon('plus', 14) + '</button>' : '') +
      '</div>';
    if (!collapsed) s.channels.filter(c => c.cat === cat.id && c.type !== 'category').forEach(c => { ch += channelItem(s, c); });
  });

  sb.innerHTML =
    '<div class="srv-head" id="srv-head">' +
    '<span class="srv-name">' + esc(s.name) + '</span>' + icon('chevronDown', 16) + '</div>' +
    '<div class="channels">' + ch + '</div>' +
    (canManageServer(s) ? '<button class="add-channel" id="add-channel">' + icon('plus', 14) + ' Створити канал</button>' : '') +
    '<div id="voice-panel"></div>' +
    userPanelHtml();

  wireSidebar(sb, s);
}

function channelItem(s, c) {
  const active = S.view.channelId === c.id;
  const unread = S.counts[c.id] || 0;
  const mention = S.mentions[c.id] || 0;
  if (c.type === 'voice') {
    const inCh = Object.keys(S.presences).filter(id => {
      const p = S.presences[id]; return p && p.voice && p.voice.channel === c.id;
    });
    let people = '';
    inCh.forEach(function (id) {
      const u = userById(id) || {};
      const p = S.presences[id] || {};
      people += '<div class="voice-user">' + avatarHtml(u, 24) + '<span>' + esc(u.displayName || u.username) + '</span>' +
        (p.voice && p.voice.share ? '<span class="voice-mic" title="Демонстрація екрана">' + icon('screen', 14) + '</span>' : '') +
        '<span class="voice-mic">' + icon((id === S.me.id ? Voice.muted : false) ? 'micOff' : 'mic', 14) + '</span></div>';
    });
    return '<div class="chan voice ' + (active ? 'active' : '') + '" data-chan="' + c.id + '" data-voice="1">' +
      icon('speaker', 20) + '<span class="chan-name">' + esc(c.name) + '</span></div>' + people;
  }
  return '<div class="chan ' + (active ? 'active' : '') + (unread ? ' unread' : '') + '" data-chan="' + c.id + '">' +
    icon('hash', 20) + '<span class="chan-name">' + esc(c.name) + '</span>' +
    (mention ? '<span class="chan-badge">' + mention + '</span>' : '') + '</div>';
}

function wireSidebar(sb, s) {
  const sh = $('#srv-head');
  if (sh && s) sh.onclick = function () {
    const r = this.getBoundingClientRect();
    dropdown(sh, [
      { label: 'Запросити людей', icon: 'userPlus', action: function () { openInvite(s); } },
      { label: 'Створити канал', icon: 'plus', action: function () { openCreateChannel(s); } },
      { label: 'Налаштування сервера', icon: 'settings', action: function () { openServerSettings(s); } },
      { separator: true },
      { label: 'Позначити як прочитане', action: function () { s.channels.forEach(c => readMark(c.id)); } },
      { label: 'Вийти з сервера', icon: 'logout', danger: true, action: async function () {
        try { await api('POST', '/servers/' + s.id + '/leave', {}); } catch (e) { toast(e.message, 'err'); }
      } }
    ]);
  };

  $$('#sidebar .chan').forEach(function (node) {
    node.onclick = function () {
      const id = node.dataset.chan;
      navigate('#/channels/' + s.id + '/' + id);
      if (node.dataset.voice) Voice.join(id, s.id);
    };
  });
  $$('#sidebar .cat-row').forEach(function (node) {
    node.querySelector('.cat-name').onclick = function () {
      S._collapsed = S._collapsed || {};
      const id = node.dataset.cat;
      S._collapsed[id] = !S._collapsed[id];
      renderSidebar();
    };
    const add = node.querySelector('.cat-add');
    if (add) add.onclick = function (e) { e.stopPropagation(); openCreateChannel(s, node.dataset.cat); };
  });
  const ac = $('#add-channel');
  if (ac) ac.onclick = function () { openCreateChannel(s); };
  wireUserPanel();
  renderVoicePanel();
}

function renderHomeSidebar(sb) {
  let list = '';
  S.dms.forEach(function (d) {
    const u = userById(d.with) || { displayName: '???', username: '?' };
    const active = S.view.type === 'dm' && S.view.dmId === d.id;
    const mention = S.mentions[d.id] || 0;
    list += '<div class="dm-row ' + (active ? 'active' : '') + (mention ? ' unread' : '') + '" data-dm="' + d.id + '">' +
      '<span class="dm-av">' + avatarHtml(u, 32) + statusDot(d.with) + '</span>' +
      '<span class="dm-name">' + esc(u.displayName || u.username) + '</span>' +
      (mention ? '<span class="chan-badge">' + mention + '</span>' : '') + '</div>';
  });
  const reqCount = S.requests.filter(r => r.to === S.me.id).length;

  sb.innerHTML =
    '<div class="home-head">' +
    '<div class="hm-search"><input id="dm-search" placeholder="Знайти або розпочати розмову"></div>' +
    '<div class="hm-nav"><button class="hm-item active" id="hm-friends">' + icon('users', 20) + ' Друзі' +
    (reqCount ? '<span class="chan-badge">' + reqCount + '</span>' : '') + '</button>' +
    '<button class="hm-item" id="hm-nitro">' + icon('rocket', 20) + ' Nitro <span class="badge-free">FREE</span></button>' +
    '</div></div>' +
    '<div class="dm-head"><span>Прямі повідомлення</span>' +
    '<button class="icon-btn" id="dm-add" title="Почати розмову">' + icon('plus', 16) + '</button></div>' +
    '<div class="dm-list">' + (list || '<div class="muted pad">Поки що порожньо</div>') + '</div>' +
    userPanelHtml();

  $('#hm-friends').onclick = function () { navigate('#/channels/@me/friends'); };
  $('#hm-nitro').onclick = openNitro;
  $('#dm-add').onclick = openNewDM;
  $('#dm-search').oninput = function () {
    const q = this.value.trim().toLowerCase();
    $$('#sidebar .dm-row').forEach(function (row) {
      const u = userById(S.dms.find(d => d.id === row.dataset.dm).with) || {};
      row.style.display = ((u.displayName || u.username || '').toLowerCase().includes(q)) ? '' : 'none';
    });
  };
  $$('#sidebar .dm-row').forEach(function (row) {
    row.onclick = function () { navigate('#/channels/@me/' + row.dataset.dm); };
  });
  wireUserPanel();
}

function userPanelHtml() {
  const u = S.me;
  let st = S.me.statusPref || 'online';
  const custom = u.custom ? '<div class="up-custom">' + esc(u.custom) + '</div>' : '';
  return '<div class="user-panel">' +
    '<div class="up-me" id="up-me">' +
    '<span class="up-av"><span class="up-avwrap">' + avatarHtml(u, 32) + '</span><span class="status-dot st-' + st + '"></span></span>' +
    '<span class="up-names"><span class="up-name">' + esc(u.displayName) + authorBadge(u) +
    (u.tag ? '<span class="usertag">' + esc(u.tag) + '</span>' : '') + '</span>' +
    '<span class="up-sub">' + (u.custom ? esc(u.custom) : ('@' + esc(u.username))) + '</span></span>' +
    '</div>' +
    '<div class="up-btns">' +
    '<button class="up-btn ' + (Voice.muted ? 'off' : '') + '" id="up-mic" title="Мікрофон">' + icon(Voice.muted ? 'micOff' : 'mic', 18) + '</button>' +
    '<button class="up-btn ' + (Voice.deafened ? 'off' : '') + '" id="up-deaf" title="Звук">' + icon(Voice.deafened ? 'headphonesOff' : 'headphones', 18) + '</button>' +
    '<button class="up-btn" id="up-settings" title="Налаштування">' + icon('settings', 18) + '</button>' +
    '</div></div>';
}

function wireUserPanel() {
  const me = $('#up-me');
  if (me) me.onclick = function () {
    dropdown(me, [
      { label: 'Онлайн', icon: 'user', action: () => setStatus('online') },
      { label: 'Неактивний', action: () => setStatus('idle') },
      { label: 'Не турбувати', action: () => setStatus('dnd') },
      { label: 'Невидимий', action: () => setStatus('invisible') },
      { separator: true },
      { label: 'Профіль', icon: 'user', action: () => openProfile(S.me.id) },
      { label: 'Nitro (безкоштовно)', icon: 'rocket', action: openNitro },
      { separator: true },
      { label: 'Вийти', icon: 'logout', danger: true, action: logout }
    ]);
  };
  const mic = $('#up-mic'); if (mic) mic.onclick = () => Voice.toggleMute();
  const deaf = $('#up-deaf'); if (deaf) deaf.onclick = () => Voice.toggleDeafen();
  const set = $('#up-settings'); if (set) set.onclick = openSettings;
}

async function setStatus(state) {
  try {
    await api('PATCH', '/me', { statusPref: state });
    S.me.statusPref = state;
  } catch (e) {}
  api('POST', '/presence', { state: state }).catch(function () {});
}

function renderVoicePanel() {
  const box = $('#voice-panel');
  if (!box) return;
  if (!Voice.channel) { box.innerHTML = ''; return; }
  const vc = voiceChannelInfo(Voice.channel);
  const sharing = !!Voice.videoStreams.share;
  const members = Object.keys(S.presences).filter(function (id) {
    const p = S.presences[id];
    return p && p.voice && p.voice.channel === Voice.channel;
  });
  let people = '';
  members.forEach(function (id) {
    const u = userById(id) || {};
    const p = S.presences[id] || {};
    people += '<div class="vp-user" data-speak="' + id + '">' + avatarHtml(u, 22) +
      '<span>' + esc(u.displayName || u.username || '') + '</span>' +
      (p.voice && p.voice.share ? '<span class="vp-ic" title="Демонстрація">' + icon('screen', 12) + '</span>' : '') +
      '<span class="vp-ic">' + icon((id === S.me.id && Voice.muted) ? 'micOff' : 'mic', 12) + '</span></div>';
  });
  box.innerHTML = '<div class="voice-panel">' +
    '<div class="vp-top"><div class="vp-signal">' + icon('volume', 14) + '</div>' +
    '<div class="vp-info"><div class="vp-name">' + esc(vc.name) + '</div>' +
    '<div class="vp-sub">' + esc(vc.sub) + '</div></div>' +
    '<button class="up-btn" id="vp-leave" title="Від’єднатися">' + icon('phoneOff', 16) + '</button></div>' +
    (sharing
      ? '<div class="vp-stream"><video id="vp-video" autoplay muted playsinline></video>' +
        '<button class="vp-stop" id="vp-stopshare">' + icon('screenOff', 14) + ' Зупинити демонстрацію</button></div>'
      : '') +
    (people ? '<div class="vp-users">' + people + '</div>' : '') +
    '</div>';
  if (sharing) {
    const v = document.querySelector('#vp-video');
    if (v && Voice.videoStreams.share) { v.srcObject = Voice.videoStreams.share; v.play().catch(function () {}); }
  }
  const lv = $('#vp-leave');
  if (lv) lv.onclick = () => Voice.leave();
  const st = $('#vp-stopshare');
  if (st) st.onclick = function () { Voice.stopVideo('share'); };
}

/* смужка голосу над полем введення */
function renderVoiceBar() {
  const bar = $('#voice-bar');
  if (!bar) return;
  if (!Voice.channel) { bar.innerHTML = ''; bar.classList.remove('show'); return; }
  const info = voiceChannelInfo(Voice.channel);
  const sharing = !!Voice.videoStreams.share;
  bar.classList.add('show');
  bar.innerHTML =
    '<div class="vb-info"><span class="vb-live">' + icon('volume', 16) + '</span>' +
    '<div class="vb-txt"><div class="vb-name">Голос підключено</div>' +
    '<div class="vb-sub">' + esc(info.name) + ' · ' + esc(info.sub) + '</div></div></div>' +
    '<div class="vb-btns">' +
    '<button class="up-btn ' + (sharing ? 'danger' : '') + '" id="vb-share" title="' + (sharing ? 'Зупинити демонстрацію' : 'Демонстрація екрана') + '">' + icon(sharing ? 'screenOff' : 'screen', 18) + '</button>' +
    '<button class="up-btn ' + (Voice.muted ? 'off' : '') + '" id="vb-mic" title="Мікрофон">' + icon(Voice.muted ? 'micOff' : 'mic', 18) + '</button>' +
    '<button class="up-btn ' + (Voice.deafened ? 'off' : '') + '" id="vb-deaf" title="Звук">' + icon(Voice.deafened ? 'headphonesOff' : 'headphones', 18) + '</button>' +
    '<button class="up-btn" id="vb-leave" title="Від’єднатися">' + icon('phoneOff', 18) + '</button>' +
    '</div>';
  const m = $('#vb-mic'); if (m) m.onclick = () => Voice.toggleMute();
  const d = $('#vb-deaf'); if (d) d.onclick = () => Voice.toggleDeafen();
  const l = $('#vb-leave'); if (l) l.onclick = () => Voice.leave();
  const sh = $('#vb-share'); if (sh) sh.onclick = () => { Voice.videoStreams.share ? Voice.stopVideo('share') : Voice.startVideo('share'); };
}

/* оновлення всіх голосових елементів одразу */
function refreshVoiceUI() {
  try { renderVoiceBar(); } catch (e) {}
  try { renderVoicePanel(); } catch (e) {}
  try { if (S._vc && document.getElementById('voice-screen') && typeof renderVoiceView === 'function') renderVoiceView(S._vc); } catch (e) {}
  try { renderOverlay(); } catch (e) {}
}

/* ------------------------------------------------------------ оверлей - */
/* Оверлей показується автоматично, поки триває голосовий дзвінок */
let overlayPos = null;
try { const o = JSON.parse(localStorage.getItem('dc_overlay') || 'null'); if (o && o.pos) overlayPos = o.pos; } catch (e) {}
function saveOverlay() { try { localStorage.setItem('dc_overlay', JSON.stringify({ pos: overlayPos })); } catch (e) {} }

/* підсвічування учасників, які зараз говорять */
function onSpeakChange(levels) {
  $$('[data-speak]').forEach(function (el) {
    const sp = levels[el.getAttribute('data-speak')] === 1;
    el.classList.toggle('speaking', sp);
  });
}

function renderOverlay() {
  const host = document.getElementById('overlays');
  if (!host) return;
  let el = document.getElementById('vc-overlay');
  if (!Voice.channel) { if (el) el.remove(); return; }
  const info = voiceChannelInfo(Voice.channel);
  const members = Object.keys(S.presences).filter(id => { const p = S.presences[id]; return p && p.voice && p.voice.channel === Voice.channel; });
  let avs = '';
  members.forEach(function (id) {
    const u = userById(id) || {};
    const p = S.presences[id] || {};
    avs += '<div class="ov-user" data-speak="' + id + '" title="' + esc(u.displayName || u.username || '') + '">' + avatarHtml(u, 40) +
      (p.voice && p.voice.share ? '<span class="ov-share">' + icon('screen', 12) + '</span>' : '') +
      ((id === S.me.id && Voice.muted) ? '<span class="ov-mute">' + icon('micOff', 11) + '</span>' : '') + '</div>';
  });
  if (!el) { el = document.createElement('div'); el.id = 'vc-overlay'; el.className = 'vc-overlay'; host.appendChild(el); }
  el.innerHTML =
    '<div class="ov-head" id="ov-drag"><span class="ov-title">' + icon('volume', 14) + ' ' + esc(info.name) + '</span></div>' +
    '<div class="ov-users">' + (avs || '<span class="muted small">Порожньо</span>') + '</div>' +
    '<div class="ov-btns">' +
    '<button class="ov-btn ' + (Voice.muted ? 'off' : '') + '" id="ov-mic" title="Мікрофон">' + icon(Voice.muted ? 'micOff' : 'mic', 16) + '</button>' +
    '<button class="ov-btn ' + (Voice.deafened ? 'off' : '') + '" id="ov-deaf" title="Звук">' + icon(Voice.deafened ? 'headphonesOff' : 'headphones', 16) + '</button>' +
    '<button class="ov-btn ' + (Voice.videoStreams.share ? 'on' : '') + '" id="ov-share" title="Демонстрація екрана">' + icon('screen', 16) + '</button>' +
    '<button class="ov-btn danger" id="ov-leave" title="Від’єднатися">' + icon('phoneOff', 16) + '</button>' +
    '</div>';
  if (overlayPos) {
    const ow = el.offsetWidth || 268;
    el.style.left = Math.min(Math.max(0, overlayPos.x), window.innerWidth - ow) + 'px';
    el.style.top = Math.min(Math.max(0, overlayPos.y), window.innerHeight - 40) + 'px';
    el.style.right = 'auto'; el.style.bottom = 'auto';
  }
  $('#ov-mic').onclick = function () { Voice.toggleMute(); };
  $('#ov-deaf').onclick = function () { Voice.toggleDeafen(); };
  $('#ov-share').onclick = function () { Voice.videoStreams.share ? Voice.stopVideo('share') : Voice.startVideo('share'); };
  $('#ov-leave').onclick = function () { Voice.leave(); };
  const drag = $('#ov-drag');
  drag.onmousedown = function (e) {
    const r = el.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    function mv(ev) {
      overlayPos = { x: Math.max(0, Math.min(ev.clientX - ox, window.innerWidth - r.width)), y: Math.max(0, Math.min(ev.clientY - oy, window.innerHeight - 40)) };
      el.style.left = overlayPos.x + 'px'; el.style.top = overlayPos.y + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
    }
    function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); saveOverlay(); }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    e.preventDefault();
  };
}

function voiceChannelInfo(chanId) {
  for (const s of S.servers) {
    const c = s.channels.find(c => c.id === chanId);
    if (c) return { name: c.name, sub: s.name };
  }
  const dm = S.dms.find(d => d.id === chanId);
  if (dm) { const u = userById(dm.with) || {}; return { name: u.displayName || u.username || 'Дзвінок', sub: 'Прямий дзвінок' }; }
  return { name: 'Голос', sub: '' };
}

/* ================================================================ учасники */

let membersTimer = null;
function renderMembersDebounced() {
  clearTimeout(membersTimer);
  membersTimer = setTimeout(renderMembers, 150);
}

function renderMembers() {
  const box = $('#members');
  if (!box) return;
  if (S.view.type === 'dm') { renderDmProfile(box); return; }
  if (S.view.type !== 'server') { box.innerHTML = ''; return; }
  const s = serverById(S.view.serverId);
  if (!s) { box.innerHTML = ''; return; }

  const online = [], offline = [];
  Object.keys(s.members).forEach(function (uid) {
    const u = S.users[uid] || { id: uid, displayName: '???', username: '?' };
    const p = S.presences[uid] || {};
    const st = p.state || 'offline';
    (st === 'offline' || st === 'invisible' ? offline : online).push(u);
  });
  const rank = u => { const m = s.members[u.id]; return m ? m.roles.length : 0; };
  online.sort((a, b) => rank(b) - rank(a));

  let html = '<div class="mem-scroll">';
  html += groupMembers(s, 'ОНЛАЙН — ' + online.length, online);
  html += groupMembers(s, 'ОФЛАЙН — ' + offline.length, offline);
  html += '</div>';
  box.innerHTML = html;

  $$('#members .mem-row').forEach(function (row) {
    row.onclick = function () { openProfile(row.dataset.uid, s); };
    row.oncontextmenu = function (e) {
      e.preventDefault();
      memberMenu(s, row.dataset.uid, e.clientX, e.clientY);
    };
  });
}

function groupMembers(s, title, list) {
  if (!list.length) return '';
  let h = '<div class="mem-group">' + esc(title) + '</div>';
  list.forEach(function (u) {
    const color = roleColor({ kind: 'server', server: s }, u.id) || '#949ba4';
    h += '<div class="mem-row" data-uid="' + u.id + '">' +
      '<span class="mem-av">' + avatarHtml(u, 32) + statusDot(u.id) + '</span>' +
      '<span class="mem-name" style="color:' + color + '">' + esc(u.displayName || u.username) + '</span>' +
      authorBadge(u) + '</div>';
  });
  return h;
}

function memberMenu(s, uid, x, y) {
  const u = userById(uid) || {};
  const items = [
    { label: 'Профіль', icon: 'user', action: function () { openProfile(uid, s); } },
    { label: 'Написати', icon: 'message', action: function () { openDMWith(uid); } }
  ];
  if (canManageServer(s) && uid !== S.me.id) {
    items.push({ separator: true });
    s.roles.forEach(function (r) {
      const has = (s.members[uid].roles || []).includes(r.id);
      items.push({
        label: (has ? '✔ ' : '') + 'Роль: ' + r.name,
        action: async function () {
          try { await api('POST', '/servers/' + s.id + '/members/' + uid + '/roles', { roleId: r.id }); }
          catch (e) { toast(e.message, 'err'); }
        }
      });
    });
    if (uid !== s.owner) items.push({ label: 'Вигнати', icon: 'logout', danger: true, action: async function () {
      try { await api('DELETE', '/servers/' + s.id + '/members/' + uid, {}); } catch (e) { toast(e.message, 'err'); }
    } });
  }
  contextMenu(x, y, items);
}

function renderDmProfile(box) {
  const dm = S.dms.find(d => d.id === S.view.dmId);
  const u = dm ? userById(dm.with) : null;
  if (!u) { box.innerHTML = ''; return; }
  box.innerHTML =
    '<div class="dm-prof-banner" style="background:' + (u.banner ? '' : (u.accent || colorFromId(u.id))) + '">' +
    (u.banner ? '<img src="' + u.banner + '">' : '') + '</div>' +
    '<div class="dm-prof">' + avatarHtml(u, 80) +
    '<div class="dm-prof-name">' + esc(u.displayName) + authorBadge(u) + '</div>' +
    '<div class="dm-prof-sub">@' + esc(u.username) + '</div>' +
    (u.about ? '<div class="dm-prof-about">' + esc(u.about) + '</div>' : '') +
    '<div class="dm-prof-sec">Учасник з ' + dateLabel(u.createdAt || Date.now()) + '</div>' +
    '<button class="btn secondary block" id="dm-prof-msg">Повідомлення</button>' +
    '</div>';
  const b = $('#dm-prof-msg');
  if (b) b.onclick = function () { const ta = $('#composer textarea'); if (ta) ta.focus(); };
}

/* ================================================================ друзі */

function renderFriends() {
  const col = $('#chat-col');
  const s = S._friendTab || 'online';
  S._friendTab = s;

  $('#chat-header').innerHTML =
    '<div class="head-left"><span class="head-name">' + icon('users', 22) + ' Друзі</span>' +
    '<span class="head-divider"></span>' +
    ['online|Онлайн', 'all|Усі', 'pending|Очікуючі', 'add|Додати друга'].map(function (t) {
      const [k, label] = t.split('|');
      return '<button class="tab ' + (s === k ? 'active' : '') + '" data-tab="' + k + '">' + label + '</button>';
    }).join('') +
    '</div>' +
    '<div class="head-right"><button class="btn primary" id="fri-add">Додати друга</button></div>';

  $$('#chat-header .tab').forEach(function (b) {
    b.onclick = function () { S._friendTab = b.dataset.tab; renderFriends(); };
  });
  $('#fri-add').onclick = function () { S._friendTab = 'add'; renderFriends(); };

  let html = '<div class="friends">';
  if (s === 'add') {
    html += '<div class="add-friend"><h3>ДОДАТИ ДРУГА</h3>' +
      '<p class="muted">Введи ім’я користувача (username).</p>' +
      '<div class="add-row"><input id="fri-name" placeholder="Ім’я користувача"><button class="btn primary" id="fri-send">Надіслати запит</button></div></div>';
  } else if (s === 'pending') {
    const incoming = S.requests.filter(r => r.to === S.me.id);
    const outgoing = S.requests.filter(r => r.from === S.me.id);
    html += '<div class="fri-group">ВХІДНІ ЗАПИТИ — ' + incoming.length + '</div>';
    html += incoming.map(r => friendRequestRow(r, 'in')).join('') || '<div class="muted pad">Немає вхідних</div>';
    html += '<div class="fri-group">ВИХІДНІ — ' + outgoing.length + '</div>';
    html += outgoing.map(r => friendRequestRow(r, 'out')).join('') || '<div class="muted pad">Немає вихідних</div>';
  } else {
    const ids = s === 'online'
      ? S.me.friends.filter(id => { const p = S.presences[id] || {}; return p.state && p.state !== 'offline' && p.state !== 'invisible'; })
      : S.me.friends;
    html += '<div class="fri-group">' + (s === 'online' ? 'ОНЛАЙН' : 'УСІ ДРУЗІ') + ' — ' + ids.length + '</div>';
    html += ids.map(id => friendRow(id)).join('') || '<div class="muted pad">Порожньо. Додай друга!</div>';
  }
  html += '</div>';
  col.innerHTML = html;

  const send = $('#fri-send');
  if (send) send.onclick = sendFriendRequest;
  const inp = $('#fri-name');
  if (inp) inp.onkeydown = function (e) { if (e.key === 'Enter') sendFriendRequest(); };
  $$('.fri-message').forEach(b => b.onclick = () => openDMWith(b.dataset.uid));
  $$('.fri-accept').forEach(b => b.onclick = async () => {
    try { await api('POST', '/friends/' + b.dataset.id + '/accept', {}); toast('Тепер ви друзі'); }
    catch (e) { toast(e.message, 'err'); }
  });
  $$('.fri-decline').forEach(b => b.onclick = async () => {
    try { await api('POST', '/friends/' + b.dataset.id + '/decline', {}); } catch (e) {}
  });
  $$('.fri-remove').forEach(b => b.onclick = () => {
    confirmBox('Видалити друга', 'Видалити цього користувача з друзів?', async function () {
      try { await api('DELETE', '/friends/' + b.dataset.uid, {}); } catch (e) {}
    });
  });
  $$('.fri-block').forEach(b => b.onclick = async () => {
    const u = userById(b.dataset.uid) || {};
    try { await api('POST', '/blocks', { username: u.username }); toast('Заблоковано'); }
    catch (e) { toast(e.message, 'err'); }
  });
}

function friendRow(id) {
  const u = userById(id) || { displayName: '???', username: '?' };
  return '<div class="fri-row"><span class="fri-av">' + avatarHtml(u, 32) + statusDot(id) + '</span>' +
    '<span class="fri-names"><span class="fri-name">' + esc(u.displayName) + authorBadge(u) + '</span>' +
    '<span class="fri-sub">' + (u.custom ? esc(u.custom) : '@' + esc(u.username)) + '</span></span>' +
    '<span class="fri-actions">' +
    '<button class="icon-btn fri-message" data-uid="' + id + '" title="Написати">' + icon('message', 18) + '</button>' +
    '<button class="icon-btn fri-remove" data-uid="' + id + '" title="Видалити">' + icon('x', 18) + '</button>' +
    '</span></div>';
}

function friendRequestRow(r, dir) {
  if (dir === 'in') {
    const u = userById(r.from) || {};
    return '<div class="fri-row"><span class="fri-av">' + avatarHtml(u, 32) + '</span>' +
      '<span class="fri-names"><span class="fri-name">' + esc(u.displayName || u.username) + '</span>' +
      '<span class="fri-sub">Вхідний запит</span></span>' +
      '<span class="fri-actions">' +
      '<button class="btn primary sm fri-accept" data-id="' + r.id + '">Прийняти</button>' +
      '<button class="btn secondary sm fri-decline" data-id="' + r.id + '">Відхилити</button>' +
      '</span></div>';
  }
  const u = userById(r.to) || {};
  return '<div class="fri-row"><span class="fri-av">' + avatarHtml(u, 32) + '</span>' +
    '<span class="fri-names"><span class="fri-name">' + esc(u.displayName || u.username) + '</span>' +
    '<span class="fri-sub">Запит надіслано</span></span>' +
    '<span class="fri-actions"><button class="btn secondary sm fri-decline" data-id="' + r.id + '">Скасувати</button></span></div>';
}

async function sendFriendRequest() {
  const inp = $('#fri-name');
  const name = inp ? inp.value.trim() : '';
  if (!name) return;
  try {
    const r = await api('POST', '/friends', { username: name });
    if (r.accepted) { toast('Тепер ви друзі!'); S._friendTab = 'all'; }
    else toast('Запит надіслано');
    renderFriends();
  } catch (e) { toast(e.message, 'err'); }
}

async function openDMWith(userId) {
  try {
    const r = await api('POST', '/dms', { userId: userId });
    if (!S.dms.some(d => d.id === r.dm.id)) S.dms.unshift(r.dm);
    navigate('#/channels/@me/' + r.dm.id);
  } catch (e) { toast(e.message, 'err'); }
}

/* ======================================================== модальні вікна */

function openAddServer() {
  const body = el('<div>' +
    '<div class="seg"><button class="seg-b active" data-seg="create">Створити</button>' +
    '<button class="seg-b" data-seg="join">Приєднатися</button></div>' +
    '<div id="seg-create">' +
    '<label class="field"><span>Назва сервера</span><input id="ns-name" placeholder="Моя спільнота" maxlength="100"></label>' +
    '<div class="icon-pick"><button class="btn secondary" id="ns-icon">Завантажити іконку</button>' +
    '<span class="muted" id="ns-icon-hint">не обов’язково</span></div>' +
    '</div>' +
    '<div id="seg-join" class="hidden">' +
    '<label class="field"><span>Код запрошення</span><input id="ns-code" placeholder="напр. 8fKq2xAb"></label>' +
    '</div></div>');
  let iconData = null;
  const modal = openModal({
    title: 'Додати сервер',
    body: body,
    actions: [
      { label: 'Скасувати' },
      { label: 'Підтвердити', kind: 'primary', onClick: async function () {
        if (body.dataset.seg === 'join') {
          const code = $('#ns-code').value.trim();
          if (!code) { toast('Введи код', 'err'); return false; }
          try {
            const r = await api('POST', '/invites/' + encodeURIComponent(code), {});
            const ch = r.server.channels.find(c => c.type === 'text');
            navigate('#/channels/' + r.server.id + '/' + (ch ? ch.id : ''));
          } catch (e) { toast(e.message, 'err'); return false; }
        } else {
          const name = $('#ns-name').value.trim();
          if (name.length < 2) { toast('Назва замала', 'err'); return false; }
          try {
            const r = await api('POST', '/servers', { name: name, icon: iconData });
            const ch = r.server.channels.find(c => c.type === 'text');
            navigate('#/channels/' + r.server.id + '/' + (ch ? ch.id : ''));
          } catch (e) { toast(e.message, 'err'); return false; }
        }
      } }
    ]
  });
  body.dataset.seg = 'create';
  $$('.seg-b', body).forEach(function (b) {
    b.onclick = function () {
      body.dataset.seg = b.dataset.seg;
      $$('.seg-b', body).forEach(x => x.classList.toggle('active', x === b));
      $('#seg-create').classList.toggle('hidden', b.dataset.seg !== 'create');
      $('#seg-join').classList.toggle('hidden', b.dataset.seg !== 'join');
    };
  });
  $('#ns-icon').onclick = function () {
    pickImage(128, function (d) { iconData = d; $('#ns-icon-hint').textContent = 'готово ✓'; });
  };
}

function openCreateChannel(s, catId) {
  const body = el('<div>' +
    '<label class="field"><span>Тип каналу</span>' +
    '<select id="nc-type"><option value="text"># Текстовий</option><option value="voice">♫ Голосовий</option>' +
    '<option value="category">▸ Категорія</option></select></label>' +
    '<label class="field"><span>Назва</span><input id="nc-name" placeholder="новий-канал" maxlength="100"></label>' +
    '</div>');
  openModal({
    title: 'Створити канал',
    body: body,
    actions: [{ label: 'Скасувати' }, { label: 'Створити', kind: 'primary', onClick: async function () {
      const name = $('#nc-name').value.trim();
      const type = $('#nc-type').value;
      if (!name) { toast('Введи назву', 'err'); return false; }
      try {
        const r = await api('POST', '/servers/' + s.id + '/channels', { name: name, type: type, cat: catId });
        if (type !== 'category') navigate('#/channels/' + s.id + '/' + r.channel.id);
      } catch (e) { toast(e.message, 'err'); return false; }
    } }]
  });
}

async function openInvite(s) {
  const body = h('div', { class: 'muted pad' }, 'Генерую посилання…');
  openModal({ title: 'Запросити людей до «' + s.name + '»', body: body });
  try {
    const r = await api('POST', '/servers/' + s.id + '/invite', {});
    const link = location.origin + location.pathname + '#/invite/' + r.code;
    body.innerHTML = '<p class="muted">Надішли це посилання — за ним приєднаються до сервера.</p>' +
      '<div class="copy-row"><input id="inv-link" readonly value="' + esc(link) + '">' +
      '<button class="btn primary" id="inv-copy">Копіювати</button></div>' +
      '<p class="muted small">Код: <b>' + esc(r.code) + '</b></p>';
    $('#inv-copy').onclick = function () { copyText(link); };
    const i = $('#inv-link'); if (i) i.select();
  } catch (e) { body.innerHTML = '<p class="muted pad">' + esc(e.message) + '</p>'; }
}

function openNewDM() {
  const body = el('<div><label class="field"><span>Ім’я користувача</span>' +
    '<input id="nd-name" placeholder="username"></label></div>');
  openModal({
    title: 'Почати розмову', body: body,
    actions: [{ label: 'Скасувати' }, { label: 'Відкрити', kind: 'primary', onClick: async function () {
      const name = $('#nd-name').value.trim().toLowerCase();
      if (!name) return false;
      const found = Object.values(S.users).find(u => u.username.toLowerCase() === name) ||
        S.me.friends.map(userById).find(u => u && (u.displayName || '').toLowerCase() === name);
      if (!found) { toast('Користувача не знайдено. Додай його у друзі.', 'err'); return false; }
      await openDMWith(found.id);
    } }]
  });
}

/* ----------------------------------------------------------- профіль ----- */

function openProfile(userId, server) {
  const u = userById(userId);
  if (!u) return;
  const isMe = userId === S.me.id;
  const p = S.presences[userId] || {};
  const st = (p.state === 'invisible' ? 'offline' : p.state) || 'offline';

  let roles = '';
  if (server && server.members[userId]) {
    server.members[userId].roles.forEach(function (rid) {
      const r = server.roles.find(x => x.id === rid);
      if (r && r.name !== '@everyone') roles += '<span class="role-chip" style="border-color:' + r.color + ';color:' + r.color + '">' + esc(r.name) + '</span>';
    });
  }

  const card = el('<div class="profile-card">' +
    '<div class="pc-banner" style="background:' + (u.banner ? '' : (u.accent || colorFromId(u.id))) + '">' +
    (u.banner ? '<img src="' + u.banner + '">' : '') +
    '<div class="pc-avatar">' + avatarHtml(u, 80) + '<span class="status-dot st-' + st + ' big"></span></div>' +
    '</div>' +
    '<div class="pc-body">' +
    '<div class="pc-name">' + esc(u.displayName) + authorBadge(u) + '</div>' +
    '<div class="pc-user">@' + esc(u.username) + (u.tag ? ' · ' + esc(u.tag) : '') + '</div>' +
    (u.custom ? '<div class="pc-custom">' + esc(u.custom) + '</div>' : '') +
    (u.about ? '<div class="pc-sec"><h4>Про мене</h4><div>' + esc(u.about) + '</div></div>' : '') +
    (roles ? '<div class="pc-sec"><h4>Ролі</h4><div class="role-chip-wrap">' + roles + '</div></div>' : '') +
    '<div class="pc-sec"><h4>Учасник з</h4><div>' + dateLabel(u.createdAt || Date.now()) + '</div></div>' +
    '</div></div>');

  const pop = h('div', { class: 'popover profile-pop' });
  pop.appendChild(card);
  document.body.appendChild(pop);

  const actions = el('<div class="pc-actions">' +
    (isMe ? '' : '<button class="btn primary block" id="pc-msg">Повідомлення</button>') +
    (isMe ? '<button class="btn secondary block" id="pc-settings">Редагувати профіль</button>' : '') +
    '</div>');
  card.appendChild(actions);
  if (!isMe) {
    $('#pc-msg', card).onclick = function () { pop.remove(); openDMWith(userId); };
  } else {
    $('#pc-settings', card).onclick = function () { pop.remove(); openSettings(); };
  }

  const r = pop.getBoundingClientRect();
  const x = Math.min(window.innerWidth - r.width - 12, window.innerWidth - r.width - 12);
  pop.style.left = x + 'px';
  pop.style.top = Math.max(12, (window.innerHeight - r.height) / 2) + 'px';
  const close = function (e) {
    if (pop.contains(e.target)) return;
    pop.remove();
    document.removeEventListener('mousedown', close, true);
  };
  setTimeout(() => document.addEventListener('mousedown', close, true), 0);
}

/* ------------------------------------------------------ налаштування ----- */

function openSettings() {
  const u = S.me;
  const body = el('<div class="settings-grid">' +
    '<div class="stg-nav">' +
    '<button class="stg-tab active" data-st="acc">Мій акаунт</button>' +
    '<button class="stg-tab" data-st="prof">Профіль</button>' +
    '<button class="stg-tab" data-st="nitro">Nitro</button>' +
    '<button class="stg-tab" data-st="snd">Звук</button>' +
    '<button class="stg-tab" data-st="theme">Оформлення</button>' +
    '</div>' +
    '<div class="stg-body">' +
    '<div data-pane="acc">' +
    '<h4>АВАТАР</h4><div class="avatar-edit">' + avatarHtml(u, 80) +
    '<div><button class="btn secondary" id="st-av">Змінити аватар</button>' +
    '<button class="btn link" id="st-av-clr">Прибрати</button></div></div>' +
    '<h4>ІМ’Я КОРИСТУВАЧА</h4>' +
    '<label class="field"><span>Відображуване ім’я</span><input id="st-display" maxlength="32" value="' + esc(u.displayName) + '"></label>' +
    '<label class="field"><span>Ім’я користувача</span><input id="st-username" maxlength="32" value="' + esc(u.username) + '"></label>' +
    '<label class="field"><span>Тег (до 4 символів)</span><input id="st-tag" maxlength="4" value="' + esc(u.tag || '') + '" placeholder="DEV"></label>' +
    '<h4>ПРО МЕНЕ</h4><textarea id="st-about" maxlength="190" rows="3">' + esc(u.about) + '</textarea>' +
    '<h4>КОЛІР АКЦЕНТУ</h4><input type="color" id="st-accent" value="' + (u.accent || '#5865f2') + '">' +
    '<h4>ВІКНО</h4>' +
    '<button class="btn secondary" id="st-full">Повний екран (F11)</button>' +
    '</div>' +
    '<div data-pane="prof" class="hidden">' +
    '<h4>БАНЕР (Nitro)</h4>' +
    (S.nitro ? '<div class="banner-edit"><div class="banner-prev" id="banner-prev" style="background:' + (u.banner ? 'url(' + u.banner + ')' : (u.accent || '#5865f2')) + '"></div>' +
      '<button class="btn secondary" id="st-banner">Завантажити банер</button>' +
      '<button class="btn link" id="st-banner-clr">Прибрати</button></div>'
      : '<p class="nitro-lock">' + icon('lock', 16) + ' Банер доступний з Nitro (безкоштовно). Увімкни його на вкладці Nitro.</p>') +
    '<h4>ПРОФІЛЬ</h4><p class="muted">Показується у картці профілю.</p>' +
    '</div>' +
    '<div data-pane="nitro" class="hidden">' +
    '<div class="nitro-box">' + icon('rocket', 28) +
    '<h3>Nitro — безкоштовно</h3>' +
    '<ul class="nitro-perks"><li>Банер профілю</li><li>Анімований/великий аватар</li>' +
    '<li>Тег до 4 символів</li><li>Завантаження до 10 МБ</li><li>Повідомлення до 4000 символів</li></ul>' +
    '<label class="switch"><input type="checkbox" id="st-nitro"' + (S.nitro ? ' checked' : '') + '> Увімкнути Nitro</label>' +
    '</div></div>' +
    '<div data-pane="snd" class="hidden">' +
    '<h4>ЗВУКИ ІНТЕРФЕЙСУ</h4>' +
    '<label class="switch"><input type="checkbox" id="st-snd"' + (SFX.enabled ? ' checked' : '') + '> Увімкнути звуки</label>' +
    '<h4>ГУЧНІСТЬ</h4>' +
    '<input type="range" id="st-snd-vol" min="0" max="1" step="0.05" value="' + SFX.volume + '">' +
    '<div class="add-row"><button class="btn secondary" id="st-snd-t1">Підключення до голосу</button>' +
    '<button class="btn secondary" id="st-snd-t2">Нове повідомлення</button>' +
    '<button class="btn secondary" id="st-snd-t3">Згадка</button>' +
    '<button class="btn secondary" id="st-snd-t4">Вихід з голосу</button>' +
    '<button class="btn secondary" id="st-snd-t5">Вихідний дзвінок</button>' +
    '<button class="btn secondary" id="st-snd-t6">Мікрофон вимк.</button>' +
    '<button class="btn secondary" id="st-snd-t7">Мікрофон увімк.</button>' +
    '<button class="btn secondary" id="st-snd-t8">Старт демонстрації</button>' +
    '<button class="btn secondary" id="st-snd-t9">Кінець демонстрації</button></div>' +
    '</div>' +
    '<div data-pane="theme" class="hidden">' +
    '<h4>ТЕМА ОФОРМЛЕННЯ</h4>' +
    '<p class="muted">Обери тему — вона зберігається автоматично. Частина тем має градієнтний фон і кнопки.</p>' +
    '<div class="theme-grid" id="theme-grid">' + themeCardsHtml() + '</div>' +
    '<h4>ФОН (ВЕСЬ ЕКРАН)</h4>' +
    '<p class="muted">Фон — на весь екран за всіма панелями. Обери пресет, встав посилання або завантаж власне зображення.</p>' +
    '<div class="bg-grid" id="bg-grid">' + bgCardsHtml() + '</div>' +
    '<div class="bg-row"><input id="bg-url" placeholder="Посилання на зображення (https://…)">' +
    '<button class="btn secondary" id="bg-url-apply">Застосувати</button></div>' +
    '<div class="bg-row"><button class="btn secondary" id="bg-file">Завантажити зображення</button>' +
    '<button class="btn secondary" id="bg-clear">Прибрати фон</button></div>' +
    '<div class="bg-row"><label class="bg-slider"><span class="muted small">Прозорість фону:</span>' +
    '<input type="range" id="bg-op" min="0" max="100" step="5" value="' + (currentBg().opacity == null ? 55 : currentBg().opacity) + '">' +
    '<b id="bg-op-val">' + (currentBg().opacity == null ? 55 : currentBg().opacity) + '%</b></label></div>' +
    '</div>' +
    '</div></div>');

  const modal = openModal({
    title: 'Налаштування',
    wide: true,
    full: true,
    body: body,
    actions: [
      { label: 'Вийти з акаунта', kind: 'danger', onClick: function () { logout(); } },
      { label: 'Зберегти', kind: 'primary', onClick: async function () {
        const patch = {
          displayName: $('#st-display').value,
          username: $('#st-username').value,
          tag: $('#st-tag').value,
          about: $('#st-about').value,
          accent: $('#st-accent').value,
          nitro: $('#st-nitro').checked
        };
        try { const r = await api('PATCH', '/me', patch); S.me = r.me; S.nitro = r.me.nitro; renderApp(); toast('Збережено'); }
        catch (e) { toast(e.message, 'err'); }
      } }
    ]
  });

  $$('.stg-tab', body).forEach(function (b) {
    b.onclick = function () {
      $$('.stg-tab', body).forEach(x => x.classList.toggle('active', x === b));
      $$('[data-pane]', body).forEach(p => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.st));
    };
  });
  $('#st-av').onclick = function () {
    pickImage(256, async function (d) {
      try { const r = await api('PATCH', '/me', { avatar: d }); S.me = r.me; toast('Аватар оновлено'); }
      catch (e) { toast(e.message, 'err'); }
    });
  };
  $('#st-av-clr').onclick = async function () { try { const r = await api('PATCH', '/me', { avatar: null }); S.me = r.me; } catch (e) {} };
  const sb2 = $('#st-banner');
  if (sb2) sb2.onclick = function () {
    pickImage(600, async function (d) {
      try { const r = await api('PATCH', '/me', { banner: d }); S.me = r.me; toast('Банер оновлено'); $('#banner-prev').style.background = 'url(' + d + ')'; }
      catch (e) { toast(e.message, 'err'); }
    });
  };
  const sbc = $('#st-banner-clr');
  if (sbc) sbc.onclick = async function () { try { const r = await api('PATCH', '/me', { banner: null }); S.me = r.me; } catch (e) {} };
  const stf = $('#st-full');
  if (stf) stf.onclick = function () { toggleFullscreen(); };

  const snd = $('#st-snd');
  if (snd) snd.onchange = function () { SFX.enabled = this.checked; saveSfx(); };
  const sndv = $('#st-snd-vol');
  if (sndv) { sndv.oninput = function () { SFX.volume = parseFloat(this.value); saveSfx(); }; sndv.onchange = function () { playSound('notification'); }; }
  const t1 = $('#st-snd-t1'); if (t1) t1.onclick = function () { playSound('join'); };
  const t2 = $('#st-snd-t2'); if (t2) t2.onclick = function () { playSound('notification'); };
  const t3 = $('#st-snd-t3'); if (t3) t3.onclick = function () { playSound('mention'); };
  const t4 = $('#st-snd-t4'); if (t4) t4.onclick = function () { playSound('leave'); };
  const t5 = $('#st-snd-t5'); if (t5) t5.onclick = function () { playSound('call'); };
  const t6 = $('#st-snd-t6'); if (t6) t6.onclick = function () { playSound('mute'); };
  const t7 = $('#st-snd-t7'); if (t7) t7.onclick = function () { playSound('unmute'); };
  const t8 = $('#st-snd-t8'); if (t8) t8.onclick = function () { playSound('shareOn'); };
  const t9 = $('#st-snd-t9'); if (t9) t9.onclick = function () { playSound('shareOff'); };

  const tgrid = $('#theme-grid');
  if (tgrid) tgrid.onclick = function (e) {
    const c = e.target.closest ? e.target.closest('.theme-card') : null;
    if (!c) return;
    applyTheme(c.dataset.theme);
    tgrid.innerHTML = themeCardsHtml();
  };

  const bgGrid = $('#bg-grid');
  if (bgGrid) bgGrid.onclick = function (e) {
    const c = e.target.closest ? e.target.closest('.bg-card') : null;
    if (!c) return;
    const p = BG_PRESETS.filter(function (x) { return x.id === c.dataset.bg; })[0];
    if (!p) return;
    const bg = currentBg();
    if (p.img) bg.img = p.img; else delete bg.img;
    saveBg(bg); applyBg(bg); bgGrid.innerHTML = bgCardsHtml();
    const ov = $('#bg-op-val'); if (ov) ov.textContent = (bg.opacity == null ? 55 : bg.opacity) + '%';
  };
  const bu2 = $('#bg-url-apply');
  if (bu2) bu2.onclick = function () {
    const v = ($('#bg-url').value || '').trim().replace(/["']/g, '');
    if (!v) return;
    const bg = currentBg();
    bg.img = 'url("' + v + '")';
    saveBg(bg); applyBg(bg); bgGrid.innerHTML = bgCardsHtml();
  };
  const bf2 = $('#bg-file');
  if (bf2) bf2.onclick = function () {
    const inp = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    document.body.appendChild(inp);
    inp.onchange = function () {
      const f = inp.files && inp.files[0];
      if (!f) return;
      if (f.size > 6 * 1048576) { toast('Файл завеликий (до 6 МБ)', 'err'); return; }
      const fr = new FileReader();
      fr.onload = function () {
        const bg = currentBg();
        bg.img = 'url("' + fr.result + '")';
        saveBg(bg); applyBg(bg); bgGrid.innerHTML = bgCardsHtml();
        toast('Фон чату оновлено');
      };
      fr.readAsDataURL(f);
    };
    inp.click();
  };
  const bc2 = $('#bg-clear');
  if (bc2) bc2.onclick = function () {
    const bg = currentBg(); delete bg.img; saveBg(bg); applyBg(bg); bgGrid.innerHTML = bgCardsHtml();
  };
  const bop2 = $('#bg-op');
  if (bop2) bop2.oninput = function () {
    const bg = currentBg(); bg.opacity = parseInt(this.value, 10) || 0; saveBg(bg); applyBg(bg);
    const ov = $('#bg-op-val'); if (ov) ov.textContent = this.value + '%';
  };
}

function openNitro() {
  const body = el('<div class="nitro-box big">' + icon('rocket', 36) +
    '<h2>Nitro тут безкоштовний</h2>' +
    '<p class="muted">Усі можливості платного Nitro — безкоштовно й назавжди.</p>' +
    '<ul class="nitro-perks"><li>Банер профілю та анімована аватарка</li>' +
    '<li>Завантаження файлів до 10 МБ</li><li>Повідомлення до 4000 символів</li>' +
    '<li>Тег біля імені</li><li>Бейдж NITRO у чаті</li></ul>' +
    '<label class="switch"><input type="checkbox" id="nt-on"' + (S.nitro ? ' checked' : '') + '> Увімкнено</label></div>');
  openModal({
    title: 'Nitro', body: body,
    actions: [{ label: 'Готово', kind: 'primary', onClick: async function () {
      const on = $('#nt-on').checked;
      try { const r = await api('PATCH', '/me', { nitro: on }); S.me = r.me; S.nitro = on; renderApp(); toast(on ? 'Nitro активовано ✨' : 'Nitro вимкнено'); }
      catch (e) { toast(e.message, 'err'); }
    } }]
  });
}

/* =========================================================== налаштування сервера */

const PRESET_TAGS = ['Ігри', 'Музика', 'Освіта', 'Спорт', 'Технології', 'Розваги', 'Аніме',
  'Мистецтво', 'Кіно', 'Наука', 'Подорожі', 'Кулінарія', 'Природа', 'Фотографія',
  'Програмування', 'Обговорення', 'Спільнота', 'Меми', 'Кіберспорт', 'Хобі'];
function boostLevelOf(s) { const n = (s.boosts || []).length; if (n >= 14) return 3; if (n >= 7) return 2; if (n >= 1) return 1; return 0; }
function boostNextOf(s) { const n = (s.boosts || []).length; if (n < 1) return 1; if (n < 7) return 7; if (n < 14) return 14; return 0; }
function tagLimitOf(s) { return [2, 5, 10, 20][boostLevelOf(s)]; }

function openServerSettings(s) {
  const lvl = boostLevelOf(s);
  const next = boostNextOf(s);

  const body = el('<div class="settings-grid">' +
    '<div class="stg-nav">' +
    '<button class="stg-tab active" data-st="gen">Огляд</button>' +
    '<button class="stg-tab" data-st="roles">Ролі</button>' +
    '<button class="stg-tab" data-st="members">Учасники</button>' +
    '<button class="stg-tab" data-st="boost">Буст</button>' +
    '<button class="stg-tab" data-st="tags">Теги</button>' +
    '</div><div class="stg-body">' +
    '<div data-pane="gen">' +
    '<h4>ІКОНКА СЕРВЕРА</h4>' +
    '<div class="ss-icon-row">' + (s.icon ? '<img class="ss-icon-prev" src="' + esc(s.icon) + '">' : '<div class="ss-icon-prev noimg">' + esc(String(s.name || '?')[0].toUpperCase()) + '</div>') +
    '<div><button class="btn secondary" id="ss-icon">Змінити</button>' +
    (s.icon ? '<button class="btn link" id="ss-icon-clr">Прибрати</button>' : '') + '</div></div>' +
    '<h4>НАЗВА СЕРВЕРА</h4><label class="field"><input id="ss-name" value="' + esc(s.name) + '" maxlength="100"></label>' +
    '<h4>ОПИС СЕРВЕРА</h4><textarea id="ss-desc" rows="2" maxlength="400" placeholder="Короткий опис сервера…">' + esc(s.desc || '') + '</textarea>' +
    '<h4>БАНЕР СЕРВЕРА' + (lvl >= 1 ? '' : ' <span class="muted small">· відкривається на Буст 1</span>') + '</h4>' +
    (lvl >= 1
      ? '<div class="ss-icon-row">' + (s.banner ? '<img class="ss-banner-prev" src="' + esc(s.banner) + '">' : '<div class="ss-banner-prev empty"></div>') +
        '<div><button class="btn secondary" id="ss-banner">' + (s.banner ? 'Змінити банер' : 'Додати банер') + '</button></div></div>'
      : '<p class="muted small">Забусти сервер до 1 рівня, щоб додати банер.</p>') +
    '<h4>РЕГІОН</h4><label class="field"><select id="ss-region">' +
    [['auto', 'Автоматично'], ['europe', 'Західна Європа'], ['usa', 'Північна Америка'], ['asia', 'Азія']].map(o => '<option value="' + o[0] + '"' + ((s.region || 'europe') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
    '</select></label>' +
    '<h4>РІВЕНЬ ПЕРЕВІРКИ</h4><label class="field"><select id="ss-verify">' +
    ['Немає', 'Низький — email підтверджено', 'Середній — акаунт 5 хвилин', 'Високий — 10 хвилин у сервері', 'Найвищий — прив’язаний телефон'].map(function (t, i) { return '<option value="' + i + '"' + (s.verify === i ? ' selected' : '') + '>' + t + '</option>'; }).join('') +
    '</select></label>' +
    '<h4>СПОВІЩЕННЯ ЗА ЗАМОВЧУВАННЯМ</h4><label class="field"><select id="ss-notify">' +
    [['0', 'Усі повідомлення'], ['1', 'Лише @згадування']].map(o => '<option value="' + o[0] + '"' + (String(s.notify) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
    '</select></label>' +
    '<h4>ФІЛЬТР КОНТЕНТУ</h4><label class="field"><select id="ss-filter">' +
    [['0', 'Не фільтрувати'], ['1', 'Фільтрувати медіа від незнайомців'], ['2', 'Фільтрувати все']].map(o => '<option value="' + o[0] + '"' + (String(s.filter) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
    '</select></label>' +
    '<h4>БУСТИ СЕРВЕРА</h4><p class="muted" id="ss-boost-info">' + (s.boosts || []).length + ' бустів · рівень ' + lvl + (next ? ' · до рівня ' + (lvl + 1) + ' ще ' + Math.max(0, next - (s.boosts || []).length) : '') + '</p>' +
    '<h4>НЕБЕЗПЕЧНА ЗОНА</h4>' +
    (s.owner === S.me.id ? '<button class="btn danger" id="ss-del">Видалити сервер</button>' : '<p class="muted">Лише власник може видалити сервер.</p>') +
    '</div>' +
    '<div data-pane="roles" class="hidden"><h4>РОЛІ</h4><div id="ss-roles"></div>' +
    (s.owner === S.me.id ? '<div class="add-row"><input id="ss-role-name" placeholder="Назва ролі"><input type="color" id="ss-role-color" value="#5865f2">' +
      '<label class="inline-check"><input type="checkbox" id="ss-role-manage"> Керування</label>' +
      '<button class="btn primary" id="ss-role-add">Додати</button></div>' : '<p class="muted">Лише власник редагує ролі.</p>') +
    '</div>' +
    '<div data-pane="members" class="hidden"><h4>УЧАСНИКИ — ' + Object.keys(s.members).length + '</h4><div id="ss-members"></div></div>' +
    '<div data-pane="boost" class="hidden"><div id="ss-boost"></div></div>' +
    '<div data-pane="tags" class="hidden"><div id="ss-tags"></div></div>' +
    '</div></div>');

  const modal = openModal({
    title: 'Налаштування сервера', wide: true, full: true, body: body,
    actions: [{ label: 'Зберегти', kind: 'primary', onClick: async function () {
      const name = $('#ss-name').value.trim();
      if (name.length < 2) { toast('Назва замала', 'err'); return false; }
      try {
        await api('PATCH', '/servers/' + s.id, {
          name: name,
          desc: $('#ss-desc').value,
          region: $('#ss-region').value,
          verify: Number($('#ss-verify').value),
          notify: Number($('#ss-notify').value),
          filter: Number($('#ss-filter').value)
        });
        toast('Збережено');
      } catch (e) { toast(e.message, 'err'); return false; }
    } }]
  });

  const reopen = async function () {
    modal.close();
    try { const st = await api('GET', '/state'); Object.assign(S, st); } catch (e) {}
    const fresh = (S.servers || []).filter(function (x) { return x.id === s.id; })[0];
    openServerSettings(fresh || s);
  };

  $$('.stg-tab', body).forEach(b => b.onclick = function () {
    $$('.stg-tab', body).forEach(x => x.classList.toggle('active', x === b));
    $$('[data-pane]', body).forEach(p => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.st));
  });

  /* Огляд */
  $('#ss-icon').onclick = function () { pickImage(128, async d => { try { await api('PATCH', '/servers/' + s.id, { icon: d }); } catch (e) { toast(e.message, 'err'); } }); };
  const ic = $('#ss-icon-clr');
  if (ic) ic.onclick = async function () { try { await api('PATCH', '/servers/' + s.id, { icon: null }); } catch (e) {} };
  const bn = $('#ss-banner');
  if (bn) bn.onclick = function () { pickImage(600, async d => { try { await api('PATCH', '/servers/' + s.id, { banner: d }); } catch (e) { toast(e.message, 'err'); } }); };
  const del = $('#ss-del');
  if (del) del.onclick = function () {
    confirmBox('Видалити сервер', 'Це незворотно.', async function () {
      try { await api('DELETE', '/servers/' + s.id, {}); modal.close(); } catch (e) { toast(e.message, 'err'); }
    });
  };

  /* Ролі */
  const rolesBox = $('#ss-roles', body);
  s.roles.forEach(function (r) {
    const row = el('<div class="role-row"><span class="role-dot" style="background:' + r.color + '"></span>' +
      '<span class="role-name">' + esc(r.name) + (r.manage ? ' · керування' : '') + '</span>' +
      (s.owner === S.me.id && s.roles.length > 1 ? '<button class="icon-btn role-del">' + icon('trash', 16) + '</button>' : '') + '</div>');
    const rd = row.querySelector('.role-del');
    if (rd) rd.onclick = async function () { try { await api('DELETE', '/servers/' + s.id + '/roles/' + r.id, {}); modal.close(); } catch (e) { toast(e.message, 'err'); } };
    rolesBox.appendChild(row);
  });
  const radd = $('#ss-role-add');
  if (radd) radd.onclick = async function () {
    const name = $('#ss-role-name').value.trim();
    if (!name) { toast('Введи назву', 'err'); return; }
    try { await api('POST', '/servers/' + s.id + '/roles', { name: name, color: $('#ss-role-color').value, manage: $('#ss-role-manage').checked }); modal.close(); }
    catch (e) { toast(e.message, 'err'); }
  };

  /* Учасники */
  const memBox = $('#ss-members', body);
  Object.keys(s.members).forEach(function (uid) {
    const u = S.users[uid] || {};
    const row = el('<div class="mem-row"><span class="mem-av">' + avatarHtml(u, 28) + '</span>' +
      '<span class="mem-name">' + esc(u.displayName || u.username || '???') + (uid === s.owner ? ' · власник' : '') + '</span>' +
      (uid !== s.owner && s.owner === S.me.id ? '<button class="icon-btn mem-kick" title="Вигнати">' + icon('logout', 16) + '</button>' : '') + '</div>');
    const kk = row.querySelector('.mem-kick');
    if (kk) kk.onclick = function () {
      confirmBox('Вигнати учасника', 'Він одразу втратить доступ до сервера.', async function () {
        try { await api('DELETE', '/servers/' + s.id + '/members/' + uid, {}); reopen(); } catch (e) { toast(e.message, 'err'); }
      });
    };
    memBox.appendChild(row);
  });

  /* Буст і теги */
  renderServerBoost(s, reopen);
  renderServerTags(s, reopen);
}

function renderServerBoost(s, reopen) {
  const box = $('#ss-boost');
  if (!box) return;
  const n = (s.boosts || []).length;
  const lvl = boostLevelOf(s);
  const next = boostNextOf(s);
  const pct = next ? Math.min(100, Math.round((n / next) * 100)) : 100;
  const my = !!((s.boosts || []).find(b => b.uid === S.me.id));
  const perks = [
    [1, 'Банер сервера та +50 слотів емодзі'],
    [2, '+50 слотів емодзі та вища якість звуку'],
    [3, 'Ексклюзивне посилання та +100 слотів емодзі']
  ];
  box.innerHTML =
    '<div class="boost-head"><span class="boost-lvl">' + icon('rocket', 20) + ' Рівень ' + lvl + '</span><div style="flex:1"><div class="boost-count">' +
    n + ' буст' + (n === 1 ? '' : 'ів') + (next ? ' · до рівня ' + (lvl + 1) + ' ще ' + Math.max(0, next - n) : ' · максимальний рівень') +
    '<div class="boost-bar"><i style="width:' + pct + '%"></i></div></div></div></div>' +
    '<div class="add-row" style="margin:12px 0 4px"><button class="btn ' + (my ? 'secondary' : 'primary') + '" id="ss-boost-btn">' +
    (my ? icon('rocket', 16) + ' Зняти буст' : icon('rocket', 16) + ' Буст сервера') + '</button></div>' +
    '<h4>ХТО БУСТИТЬ</h4>' +
    (n
      ? s.boosts.map(b => { const u = S.users[b.uid] || {}; return '<div class="fri-row"><span class="mem-av">' + avatarHtml(u, 26) + '</span>' +
          '<span class="fri-name">' + esc(u.displayName || u.username || '???') + '</span></div>'; }).join('')
      : '<p class="muted small">Поки ніхто. Перший буст миттєво відкриває 1 рівень.</p>') +
    '<h4>ПЕРКИ РІВНІВ</h4><div class="boost-perks">' +
    perks.map(p => '<div class="perk-row' + (lvl >= p[0] ? ' on' : '') + '"><span class="perk-check">' + (lvl >= p[0] ? '✓' : '·') + '</span>Рівень ' + p[0] + ' — ' + p[1] + '</div>').join('') +
    '</div>';
  const bb = $('#ss-boost-btn');
  if (bb) bb.onclick = async function () {
    try { const r = await api('POST', '/servers/' + s.id + '/boost', {}); toast(r.boosted ? 'Сервер забущено 🚀' : 'Буст знято'); reopen(); }
    catch (e) { toast(e.message, 'err'); }
  };
}

function renderServerTags(s, reopen) {
  const box = $('#ss-tags');
  if (!box) return;
  const lvl = boostLevelOf(s);
  const lim = tagLimitOf(s);
  const has = s.tags || [];
  box.innerHTML =
    '<div class="tag-head"><span>Теги сервера — ' + has.length + '/' + lim + '</span>' +
    (lvl >= 1 ? '<span class="muted small">власні теги — доступні</span>' : '<span class="muted small">власний тег — з Буст 1</span>') + '</div>' +
    '<div class="tag-chips">' +
    (has.length ? has.map(t => '<span class="tag-chip">' + esc(t.name) + (t.custom ? '<b title="власний">*</b>' : '') +
      '<button class="tag-x" data-tid="' + t.id + '" title="Прибрати">' + icon('x', 12) + '</button></span>').join('')
      : '<span class="muted small">Ще немає тегів</span>') +
    '</div>' +
    '<h4>ОБРАТИ З ПРЕСЕТІВ</h4><div class="tag-grid">' +
    PRESET_TAGS.map(nm => {
      const on = has.some(t => t.name === nm);
      return '<button class="tag-btn' + (on ? ' done' : '') + '" data-tag="' + esc(nm) + '"' + (on || has.length >= lim ? ' disabled' : '') + '>' + esc(nm) + '</button>';
    }).join('') +
    '</div>' +
    '<h4>СТВОРИТИ ВЛАСНИЙ ТЕГ' + (lvl >= 1 ? '' : ' <span class="muted small">(Буст 1+)</span>') + '</h4>' +
    '<div class="add-row"><input id="ss-tag-custom" maxlength="24" placeholder="Назва власного тега">' +
    '<button class="btn primary" id="ss-tag-add"' + (lvl < 1 ? ' disabled' : '') + '>Додати</button></div>' +
    (lvl < 1 ? '<p class="muted small">Забусти сервер до 1 рівня, щоб створювати власні теги. Пресети доступні всім учасникам.</p>' : '');

  $$('.tag-btn', box).forEach(b => b.onclick = async function () {
    if (this.disabled) return;
    try { await api('POST', '/servers/' + s.id + '/tags', { name: this.dataset.tag }); toast('Тег додано'); reopen(); }
    catch (e) { toast(e.message, 'err'); }
  });
  $$('.tag-x', box).forEach(b => b.onclick = async function () {
    try { await api('DELETE', '/servers/' + s.id + '/tags/' + this.dataset.tid, {}); reopen(); }
    catch (e) { toast(e.message, 'err'); }
  });
  const add = $('#ss-tag-add');
  if (add) add.onclick = async function () {
    const v = ($('#ss-tag-custom').value || '').trim();
    if (!v) { toast('Введи назву тега', 'err'); return; }
    try { await api('POST', '/servers/' + s.id + '/tags', { name: v, custom: true }); toast('Власний тег створено'); reopen(); }
    catch (e) { toast(e.message, 'err'); }
  };
}

/* ================================================== повний екран вікна ==== */
/* як у Discord: кнопка в Налаштуваннях + F11. Працює у вікні застосунку. */
function toggleFullscreen() {
  if (document.fullscreenElement) {
    if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
  } else {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  }
}
document.addEventListener('keydown', function (e) {
  if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
});

/* гарантований повний екран: якщо Edge проігнорував --start-maximized,
   розтягуємо вікно застосунку на весь робочий стіл одразу після старту */
function fitWindow() {
  try {
    if (!screen || !screen.availWidth || !screen.availHeight) return;
    if (window.outerWidth >= screen.availWidth - 4 && window.outerHeight >= screen.availHeight - 4) return;
    try { window.moveTo(screen.availLeft || 0, screen.availTop || 0); } catch (e) {}
    try { window.resizeTo(screen.availWidth, screen.availHeight); } catch (e) {}
  } catch (e) {}
}
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(fitWindow, 300);
} else {
  window.addEventListener('load', function () { setTimeout(fitWindow, 300); });
}

/* ================================================================ вхід */

/* Перевірка імені користувача (та сама логіка, що на сервері). */
const NAME_OK = /^[a-z0-9._а-яіїєґ'’ʼ\- ]{2,32}$/i;
function badNameChars(s) {
  const bad = [];
  Array.from(s).forEach(function (ch) {
    if (!/[a-z0-9._а-яіїєґ'’ʼ\- ]/i.test(ch) && bad.indexOf(ch) < 0) bad.push(ch);
  });
  return bad;
}

/* Генератор простих, але надійних паролів: три короткі слова + число. */
function genPassword() {
  const w = ['kit', 'sun', 'fox', 'cat', 'moon', 'star', 'cake', 'leaf', 'wolf', 'blue',
    'rain', 'snow', 'fish', 'bird', 'tree', 'book', 'milk', 'road', 'game', 'lion',
    'cola', 'kiwi', 'mint', 'nest', 'pond', 'dune', 'lime', 'bees'];
  const pick = function () { return w[Math.floor(Math.random() * w.length)]; };
  return pick() + '-' + pick() + '-' + (Math.floor(Math.random() * 90) + 10);
}

function renderAuth() {
  $('#boot').classList.add('hidden');
  $('#app').classList.add('hidden');
  const auth = $('#auth');
  auth.classList.remove('hidden');
  auth.innerHTML =
    '<div class="auth-wrap">' +
    '<div class="auth-glow"></div>' +
    '<div class="auth-card">' +
    '<div class="auth-logo">' + icon('logo', 48) + '</div>' +
    '<h2 class="auth-title" id="a-title">З поверненням!</h2>' +
    '<p class="auth-sub" id="a-sub">Ми скучили за тобою!</p>' +
    '<div id="auth-fields">' +
    '<label class="field"><span>Ім’я користувача</span>' +
    '<input id="a-user" autocomplete="username" maxlength="32" placeholder="напр. taras_2024">' +
    '<small class="field-hint">2–32 символи: літери (укр./англ.), цифри, пробіл, . _ - та апостроф ’</small></label>' +
    '<div id="a-reg-only" class="hidden"><label class="field"><span>Відображуване ім’я</span>' +
    '<input id="a-display" maxlength="32" placeholder="напр. Тарас"></label></div>' +
    '<label class="field"><span>Пароль</span>' +
    '<div class="pass-wrap">' +
    '<input id="a-pass" type="password" autocomplete="current-password" maxlength="64" placeholder="будь-який, щонайменше 4 символи">' +
    '<button type="button" class="pass-eye" id="a-eye" title="Показати пароль">' + icon('eye', 18) + '</button>' +
    '</div>' +
    '<small class="field-hint">Можна простий пароль — головне 4+ символи. Будь-які літери, цифри чи знаки.</small>' +
    '</label>' +
    '<div id="a-reg-extra" class="hidden">' +
    '<label class="field"><span>Повторіть пароль</span>' +
    '<div class="pass-wrap">' +
    '<input id="a-pass2" type="password" autocomplete="new-password" maxlength="64" placeholder="той самий пароль">' +
    '<button type="button" class="pass-eye" id="a-eye2" title="Показати пароль">' + icon('eye', 18) + '</button>' +
    '</div></label>' +
    '<button type="button" class="link-btn gen-pass" id="a-gen">Згенерувати пароль за мене</button>' +
    '</div>' +
    '</div>' +
    '<p class="auth-err" id="a-err"></p>' +
    '<button class="btn primary block big" id="a-go">Увійти</button>' +
    '<p class="auth-switch" id="a-switch"></p>' +
    '</div></div>';

  let mode = 'login';

  function applyMode() {
    const reg = mode === 'reg';
    $('#a-reg-only').classList.toggle('hidden', !reg);
    $('#a-reg-extra').classList.toggle('hidden', !reg);
    $('#a-pass').setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
    $('#a-title').textContent = reg ? 'Створити акаунт' : 'З поверненням!';
    $('#a-sub').textContent = reg ? 'Створімо твій акаунт у Месенджері.' : 'Ми скучили за тобою!';
    $('#a-go').textContent = reg ? 'Створити акаунт' : 'Увійти';
    $('#a-err').textContent = '';
    const sw = $('#a-switch');
    if (sw) {
      sw.innerHTML = reg
        ? 'Уже маєш акаунт? <button type="button" class="link-btn" data-a="login">Увійти</button>'
        : 'Потрібен акаунт? <button type="button" class="link-btn" data-a="reg">Зареєструватися</button>';
      sw.querySelector('.link-btn').onclick = function () { mode = this.dataset.a; applyMode(); };
    }
  }

  function bindEye(inpSel, btnSel) {
    const btn = $(btnSel);
    btn.onclick = function () {
      const inp = $(inpSel);
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.innerHTML = icon(show ? 'eyeOff' : 'eye', 18);
      btn.title = show ? 'Сховати пароль' : 'Показати пароль';
    };
  }
  bindEye('#a-pass', '#a-eye');
  bindEye('#a-pass2', '#a-eye2');

  $('#a-gen').onclick = function () {
    const p = genPassword();
    $('#a-pass').value = p;
    $('#a-pass2').value = p;
    $('#a-pass').type = 'text';
    $('#a-pass2').type = 'text';
    $('#a-eye').innerHTML = icon('eyeOff', 18);
    $('#a-eye2').innerHTML = icon('eyeOff', 18);
    toast('Твій пароль: ' + p + ' — запиши його', 'warn');
  };

  $$('#auth-fields input').forEach(function (inp) {
    inp.onkeydown = function (e) { if (e.key === 'Enter') doAuth(); };
  });
  $('#a-go').onclick = doAuth;

  async function doAuth() {
    const username = $('#a-user').value.trim();
    const password = $('#a-pass').value;
    const displayName = $('#a-display').value.trim();
    const errBox = $('#a-err');
    errBox.textContent = '';
    try {
      if (username.length < 2) throw new Error('Ім’я: мінімум 2 символи');
      if (username.length > 32) throw new Error('Ім’я: максимум 32 символи');
      if (!NAME_OK.test(username)) {
        const bad = badNameChars(username);
        throw new Error('Ім’я: не можна символи ' + bad.map(c => '«' + c + '»').join(', '));
      }
      if (password.length < 4) throw new Error('Пароль: мінімум 4 символи');
      if (password.length > 64) throw new Error('Пароль: максимум 64 символи');
      if (mode === 'reg' && password !== $('#a-pass2').value) throw new Error('Паролі не збігаються — перевір другий рядок');
      let r;
      if (mode === 'reg') r = await api('POST', '/register', { username: username, password: password, displayName: displayName });
      else r = await api('POST', '/login', { username: username, password: password });
      saveToken(r.token);
      const st = await api('GET', '/state');
      hydrate(st);
      connectEvents();
      armIdle();
      navigate('#/channels/@me');
    } catch (e) {
      errBox.textContent = e.message;
    }
  }

  applyMode();
}

/* ============================================================ підписки */

on('presence', function (d) {
  S.presences[d.userId] = d.presence;
  renderMembersDebounced();
  renderSidebar();
  if (d.userId === S.me.id) renderRail();
});
on('user.updated', function (d) { S.users[d.user.id] = d.user; renderMembersDebounced(); renderRail(); renderSidebar(); });
on('me.updated', function (d) { S.me = d.me; S.nitro = !!d.me.nitro; renderSidebar(); renderRail(); });
on('message.created', onMessageIncoming);
on('message.updated', function (d) {
  const c = S.cache[d.channel];
  if (c) { const i = c.messages.findIndex(m => m.id === d.message.id); if (i >= 0) { c.messages[i] = d.message; if (isViewing(d.channel)) replaceMessageDom(d.message); } }
});
on('message.deleted', function (d) {
  const c = S.cache[d.channel];
  if (c) { c.messages = c.messages.filter(m => m.id !== d.id); if (isViewing(d.channel)) removeMessageDom(d.id); }
});
on('reaction.updated', function (d) {
  const c = S.cache[d.channel];
  if (c) { const m = c.messages.find(x => x.id === d.id); if (m) { m.reactions = d.reactions; if (isViewing(d.channel)) refreshMessageDom(m); } }
});
on('typing', function (d) {
  if (!S.typing[d.channel]) S.typing[d.channel] = {};
  S.typing[d.channel][d.userId] = d.until;
  if (curChannel() === d.channel) kickTypingRender();
});
on('server.updated', function (d) {
  const i = S.servers.findIndex(s => s.id === d.server.id);
  if (i >= 0) S.servers[i] = d.server; else S.servers.push(d.server);
  if (S.view.type === 'server' && S.view.serverId === d.server.id) {
    S.view.server = d.server;
    const still = d.server.channels.some(c => c.id === S.view.channelId);
    if (!still) {
      const t = d.server.channels.find(c => c.type === 'text');
      navigate(t ? '#/channels/' + d.server.id + '/' + t.id : '#/channels/' + d.server.id);
    } else { renderSidebar(); renderMembers(); renderChatHeader(); }
  }
  renderRail();
});
on('server.deleted', function (d) {
  S.servers = S.servers.filter(s => s.id !== d.serverId);
  if (S.view.type === 'server' && S.view.serverId === d.serverId) navigate('#/channels/@me');
  renderRail();
});
on('server.joined', function (d) {
  if (!S.servers.some(s => s.id === d.server.id)) S.servers.push(d.server);
  renderRail();
});
on('dm.created', function (d) {
  if (d.user) S.users[d.user.id] = d.user;
  if (!S.dms.some(x => x.id === d.dm.id)) S.dms.unshift(d.dm);
  renderSidebar();
});
on('request.created', function (d) {
  S.requests.push(d.request);
  if (d.user) S.users[d.user.id] = d.user;
  toast('Новий запит у друзі від ' + ((d.user && (d.user.displayName || d.user.username)) || ''));
  if (S.view.type === 'friends') renderFriends(); else renderSidebar();
});
on('request.resolved', function (d) { S.requests = S.requests.filter(r => r.id !== d.id); if (S.view.type === 'friends') renderFriends(); renderSidebar(); });
on('friend.added', function (d) {
  if (d.user) S.users[d.user.id] = d.user;
  if (!S.me.friends.includes(d.user.id)) S.me.friends.push(d.user.id);
  if (S.view.type === 'friends') renderFriends(); else renderSidebar();
});
on('friend.removed', function (d) { S.me.friends = S.me.friends.filter(x => x !== d.userId); if (S.view.type === 'friends') renderFriends(); });

/* --------------------------------------------------- запрошення за лінком */

const _applyRoute = applyRoute;
applyRoute = function () {
  const m = location.hash.match(/^#\/invite\/(.+)$/);
  if (m && S.me) {
    (async function () {
      try {
        const r = await api('POST', '/invites/' + encodeURIComponent(m[1]), {});
        const ch = r.server.channels.find(c => c.type === 'text');
        navigate('#/channels/' + r.server.id + '/' + (ch ? ch.id : ''));
        toast('Приєднано до «' + r.server.name + '»');
      } catch (e) { toast(e.message, 'err'); navigate('#/channels/@me'); }
    })();
    return;
  }
  _applyRoute();
};
