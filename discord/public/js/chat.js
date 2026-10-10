/* chat.js — вікно чату: повідомлення, редактор, реакції, пошук, закріплені */
'use strict';

const GROUP_MS = 7 * 60 * 1000;   // групуємо повідомлення одного автора 7 хв

let composerState = { replyTo: null, editing: null };
let typingTimer = null;
let lastTypingSent = 0;

/* ---------------------------------------------------- поточний канал ---- */

function viewChannel() {
  if (S.view.type === 'server') {
    const s = serverById(S.view.serverId);
    if (!s) return null;
    const c = s.channels.find(c => c.id === S.view.channelId);
    if (!c) return null;
    return { kind: 'server', server: s, channel: c };
  }
  if (S.view.type === 'dm') {
    const dm = S.dms.find(d => d.id === S.view.dmId);
    if (!dm) return null;
    return { kind: 'dm', dm: dm, channel: { id: dm.id, name: '', type: 'text' } };
  }
  return null;
}

function dmOther(dm) { return userById(dm.with); }

/* ------------------------------------------------------------- відкриття - */

async function openChannel(chanId, keepScroll) {
  const vc = viewChannel();
  if (!vc) return;
  if (S.view.type === 'server') S.lastChannel[S.view.serverId] = chanId;

  const isVoice = vc.kind === 'server' && vc.channel.type === 'voice';
  if (!isVoice && !S.cache[chanId]) {
    S.cache[chanId] = { messages: [], users: {}, done: false };
    try {
      const r = await api('GET', '/channels/' + chanId + '/messages?limit=50');
      S.cache[chanId].messages = r.messages || [];
      (r.users || []).forEach(u => { S.users[u.id] = u; });
      S.cache[chanId].done = (r.messages || []).length < 50;
    } catch (e) { toast(e.message, 'err'); }
  }

  renderChatHeader();
  renderChat();
  if (!isVoice) readMark(chanId);
  if (!keepScroll) scrollToBottom();
}

/* --------------------------------------------------------------- шапка --- */

function renderChatHeader() {
  const vc = viewChannel();
  const head = $('#chat-header');
  if (!head) return;
  if (!vc) { head.innerHTML = ''; return; }

  let left = '';
  if (vc.kind === 'dm') {
    const o = dmOther(vc.dm) || { displayName: 'Невідомий' };
    left = '<span class="head-avatar">' + avatarHtml(o, 24) + '</span>' +
      '<span class="head-name">' + esc(o.displayName || o.username) + '</span>' +
      '<span class="head-divider"></span><span class="head-topic">' + esc(o.custom || '') + '</span>';
  } else if (vc.channel.type === 'voice') {
    left = icon('speaker', 22) + '<span class="head-name">' + esc(vc.channel.name) + '</span>' +
      '<span class="head-divider"></span><span class="head-topic">Голосовий канал</span>';
  } else {
    left = icon('hash', 22) + '<span class="head-name">' + esc(vc.channel.name) + '</span>' +
      (vc.channel.topic ? '<span class="head-divider"></span><span class="head-topic">' +
        esc(vc.channel.topic) + '</span>' : '');
  }

  const right =
    '<div class="head-search"><input id="search-input" placeholder="Пошук" autocomplete="off">' +
    (vc.kind === 'dm' ? '' : '<div class="head-search-icons">' + icon('bell', 18) + '</div>') + '</div>' +
    '<button class="icon-btn" id="btn-pins" title="Закріплені">' + icon('pin', 20) + '</button>' +
    '<button class="icon-btn" id="btn-members" title="Учасники">' + icon('users', 20) + '</button>' +
    '<button class="icon-btn" id="btn-inbox" title="Вхідні">' + icon('inbox', 20) + '</button>';

  head.innerHTML = '<div class="head-left">' + left + '</div><div class="head-right">' + right + '</div>';

  $('#btn-pins').onclick = openPins;
  $('#btn-members').onclick = function () {
    const m = $('#members');
    if (m) m.classList.toggle('hidden');
  };
  $('#btn-inbox').onclick = function () { toast('Вхідні: тут з’являться згадки', ''); };
  const si = $('#search-input');
  si.oninput = function () {
    if (this.value.trim().length >= 2) openSearch(this.value.trim());
    else closeSearch();
  };
  si.onkeydown = function (e) { if (e.key === 'Escape') { this.value = ''; closeSearch(); } };
}

/* ------------------------------------------------------------- чат ------ */

function renderChat() {
  const vc = viewChannel();
  const col = $('#chat-col');
  if (!vc) { if (col) col.innerHTML = ''; return; }

  if (vc.kind === 'server' && vc.channel.type === 'voice') { renderVoiceView(vc); return; }

  const typingRow = '<div id="typing-bar"></div>';
  const vbar = '<div id="voice-bar"></div>';
  const composer = '<div id="composer"></div>';

  if (!col.querySelector('#messages')) {
    col.innerHTML = '<div id="messages"></div>' + typingRow + vbar + composer;
  } else {
    col.innerHTML = '<div id="messages"></div>' + typingRow + vbar + composer;
  }
  S._msgsBox = $('#messages');
  renderMessages();
  renderComposer();
  renderVoiceBar();
  renderTyping();
}

function scrollToBottom() {
  const box = $('#messages');
  if (box) box.scrollTop = box.scrollHeight;
}

function canManageCurrent() {
  const vc = viewChannel();
  if (!vc || vc.kind !== 'server') return false;
  if (vc.server.owner === S.me.id) return true;
  const m = vc.server.members[S.me.id];
  return m && m.roles.some(rid => { const r = vc.server.roles.find(x => x.id === rid); return r && r.manage; });
}

function renderMessages() {
  const vc = viewChannel();
  const box = $('#messages');
  if (!box || !vc) return;
  const c = S.cache[vc.channel.id];
  if (!c) { box.innerHTML = ''; return; }

  let html = '';
  if (!c.done) html += '<div class="load-more" id="load-more">Завантажити ще…</div>';
  let lastAuthor = null, lastAt = 0, lastDay = null;

  c.messages.forEach(function (m) {
    const dk = dayKey(m.at);
    if (dk !== lastDay) {
      html += '<div class="date-divider"><span>' + dateLabel(m.at) + '</span></div>';
      lastDay = dk; lastAuthor = null; lastAt = 0;
    }
    const compact = m.author === lastAuthor && (m.at - lastAt) < GROUP_MS && !m.replyTo;
    html += messageHtml(m, compact, vc);
    if (!compact) { lastAuthor = m.author; lastAt = m.at; }
    else { lastAt = m.at; }
  });

  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
  wireMessages(box);
  updateLoadMore();
}

function appendMessageDom(chanId, m) {
  const vc = viewChannel();
  const box = $('#messages');
  if (!vc || vc.channel.id !== chanId || !box) return;
  const c = S.cache[chanId];
  if (!c) return;
  const last = c.messages[c.messages.length - 2];
  let lastDay = last ? dayKey(last.at) : null;
  let compact = last ? (last.author === m.author && (m.at - last.at) < GROUP_MS && !m.replyTo) : false;

  let extra = '';
  if (dayKey(m.at) !== lastDay) {
    extra += '<div class="date-divider"><span>' + dateLabel(m.at) + '</span></div>';
    compact = false;
  }
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const frag = el('<div>' + extra + messageHtml(m, compact, vc) + '</div>');
  while (frag.firstChild) box.appendChild(frag.firstChild);
  wireMessages(box);
  if (nearBottom) box.scrollTop = box.scrollHeight;
}

function updateLoadMore() {
  const lm = $('#load-more');
  if (!lm) return;
  lm.onclick = loadOlder;
}

async function loadOlder() {
  const vc = viewChannel();
  if (!vc) return;
  const c = S.cache[vc.channel.id];
  if (!c || !c.messages.length) return;
  const box = $('#messages');
  const before = c.messages[0].id;
  const prevH = box.scrollHeight;
  try {
    const r = await api('GET', '/channels/' + vc.channel.id + '/messages?before=' + before + '&limit=50');
    (r.users || []).forEach(u => { S.users[u.id] = u; });
    c.messages = (r.messages || []).concat(c.messages);
    c.done = (r.messages || []).length < 50;
    renderMessages();
    box.scrollTop = box.scrollHeight - prevH;
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------------------------------------------------- HTML повідомлення - */

function roleColor(vc, userId) {
  if (!vc || vc.kind !== 'server') return null;
  const m = vc.server.members[userId];
  if (!m || !m.roles.length) return null;
  let best = null;
  m.roles.forEach(function (rid) {
    const r = vc.server.roles.find(x => x.id === rid);
    if (r && r.color && r.color !== '#dbdee1' && (!best || r.pos > best.pos)) best = r;
  });
  return best ? best.color : null;
}

function authorBadge(u) {
  if (!u) return '';
  return u.nitro ? '<span class="badge-nitro" title="Nitro (безкоштовно)">NITRO</span>' : '';
}

function replyRefHtml(m, vc) {
  if (!m.replyTo) return '';
  const orig = (S.cache[m.channel] && S.cache[m.channel].messages.find(x => x.id === m.replyTo));
  if (!orig) return '';
  const u = userById(orig.author) || {};
  const text = (orig.content || '').slice(0, 120) || '📎 вкладення';
  return '<div class="reply-ref" data-jump="' + esc(orig.id) + '">' +
    '<span class="reply-line"></span>' +
    '<span class="reply-avatar">' + avatarHtml(u, 16) + '</span>' +
    '<span class="reply-name" style="color:' + (roleColor(vc, orig.author) || '#f2f3f5') + '">' +
    esc(u.displayName || u.username || '???') + '</span>' +
    '<span class="reply-text">' + esc(text) + '</span></div>';
}

function reactionsHtml(m) {
  const keys = Object.keys(m.reactions || {});
  if (!keys.length) return '<div class="reactions"></div>';
  let h = '<div class="reactions">';
  keys.forEach(function (e) {
    const list = m.reactions[e];
    const mine = list.includes(S.me.id);
    h += '<button class="reaction ' + (mine ? 'mine' : '') + '" data-emoji="' + esc(e) + '" title="' +
      esc(list.length) + '">' + e + '<span>' + list.length + '</span></button>';
  });
  h += '<button class="reaction add" data-add-react="1" title="Додати реакцію">' + icon('smile', 16) + '</button>';
  h += '</div>';
  return h;
}

function attachmentsHtml(m) {
  if (!m.attachments || !m.attachments.length) return '';
  let h = '<div class="attachments">';
  m.attachments.forEach(function (a) {
    h += '<img class="attach-img" src="' + esc(a.url) + '" alt="' + esc(a.name) + '" loading="lazy">';
  });
  h += '</div>';
  return h;
}

function messageHtml(m, compact, vc) {
  const u = userById(m.author) || { displayName: '???', username: 'unknown', id: m.author };
  const color = roleColor(vc, m.author) || '#f2f3f5';
  const jumbo = isJumbo(m.content) ? ' jumbo' : '';
  const pin = m.pinned ? '<span class="pin-mark" title="Закріплено">' + icon('pin', 14) + '</span>' : '';
  const editMark = m.edited ? '<span class="edited" title="' + esc(fullTime(m.edited)) + '">(ред.)</span>' : '';

  const head = compact ? '' :
    '<div class="msg-head"><span class="msg-name" style="color:' + color + '">' +
    esc(u.displayName || u.username) + '</span>' + authorBadge(u) +
    '<span class="msg-time" title="' + esc(fullTime(m.at)) + '">' + shortTime(m.at) + '</span></div>';

  return '<div class="msg' + (compact ? ' compact' : '') + '" data-id="' + m.id + '" data-author="' + m.author + '" data-at="' + m.at + '">' +
    (compact ? '<span class="compact-time">' + shortTime(m.at) + '</span>' :
      '<div class="msg-gutter">' + avatarHtml(u, 40) + '</div>') +
    '<div class="msg-body">' + replyRefHtml(m, vc) + head + pin +
    '<div class="msg-text' + jumbo + '">' + md(m.content) + '</div>' +
    attachmentsHtml(m) +
    reactionsHtml(m) +
    '</div></div>';
}

/* ---------------------------------------------------- події повідомлень - */

function wireMessages(box) {
  box.querySelectorAll('.msg').forEach(function (node) {
    if (node._wired) return;
    node._wired = true;
    node.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      messageMenu(node.dataset.id, e.clientX, e.clientY);
    });
    node.addEventListener('mouseover', function (e) {
      const add = e.target.closest('[data-add-react]');
      if (add) { e.stopPropagation(); }
    });
  });
  box.querySelectorAll('.reaction[data-emoji]').forEach(function (btn) {
    if (btn._wired) return;
    btn._wired = true;
    btn.onclick = function () { toggleReaction(btn.dataset.emoji, btn.closest('.msg').dataset.id); };
  });
  box.querySelectorAll('[data-add-react]').forEach(function (btn) {
    if (btn._wired) return;
    btn._wired = true;
    btn.onclick = function (e) {
      e.stopPropagation();
      const r = btn.getBoundingClientRect();
      emojiMenu(r.left, r.top, function (em) { toggleReaction(em, btn.closest('.msg').dataset.id); });
    };
  });
  box.querySelectorAll('[data-jump]').forEach(function (a) {
    if (a._wired) return;
    a._wired = true;
    a.onclick = function () { jumpTo(S.view.channelId, a.dataset.jump); };
  });
  box.querySelectorAll('.attach-img').forEach(function (img) {
    if (img._wired) return;
    img._wired = true;
    img.onclick = function () { lightbox(img.src); };
  });
  /* кнопки дій на повідомленні */
  box.querySelectorAll('.msg').forEach(function (node) {
    if (node.querySelector('.msg-actions')) return;
    const acts = el('<div class="msg-actions">' +
      '<button class="ma" data-act="react" title="Реакція">' + icon('smile', 18) + '</button>' +
      '<button class="ma" data-act="reply" title="Відповісти">' + icon('reply', 18) + '</button>' +
      '<button class="ma" data-act="more" title="Ще">' + icon('more', 18) + '</button></div>');
    acts.querySelector('[data-act="react"]').onclick = function () {
      const r = this.getBoundingClientRect();
      emojiMenu(r.left, r.bottom, em => toggleReaction(em, node.dataset.id));
    };
    acts.querySelector('[data-act="reply"]').onclick = function () { setReply(node.dataset.id); };
    acts.querySelector('[data-act="more"]').onclick = function (e) {
      const r = this.getBoundingClientRect();
      messageMenu(node.dataset.id, r.right, r.bottom);
    };
    node.querySelector('.msg-body').appendChild(acts);
  });
}

async function toggleReaction(emoji, mid) {
  const c = S.cache[S.view.channelId];
  if (!c) return;
  const m = c.messages.find(x => x.id === mid);
  if (!m) return;
  const list = m.reactions[emoji] || [];
  const i = list.indexOf(S.me.id);
  if (i >= 0) list.splice(i, 1); else list.push(S.me.id);
  if (list.length) m.reactions[emoji] = list; else delete m.reactions[emoji];
  refreshMessageDom(m);
  try { await api('POST', '/channels/' + S.view.channelId + '/messages/' + mid + '/reactions', { emoji: emoji }); }
  catch (e) { toast(e.message, 'err'); }
}

function refreshMessageDom(m) {
  const box = $('#messages');
  if (!box) return;
  const node = box.querySelector('.msg[data-id="' + m.id + '"]');
  if (!node) return;
  const old = node.querySelector('.reactions');
  const holder = el('<div>' + reactionsHtml(m) + '</div>');
  const fresh = holder.firstElementChild;
  if (old) old.replaceWith(fresh); else node.querySelector('.msg-body').appendChild(fresh);
  wireMessages(box);
}

function replaceMessageDom(m) {
  const box = $('#messages');
  if (!box) return;
  const node = box.querySelector('.msg[data-id="' + m.id + '"]');
  if (!node) return;
  const vc = viewChannel();
  const wrap = el('<div>' + messageHtml(m, false, vc) + '</div>');
  node.replaceWith(wrap.firstElementChild);
  wireMessages(box);
}

function removeMessageDom(id) {
  const box = $('#messages');
  if (!box) return;
  const node = box.querySelector('.msg[data-id="' + id + '"]');
  if (node) node.remove();
}

function messageMenu(mid, x, y) {
  const c = S.cache[S.view.channelId];
  if (!c) return;
  const m = c.messages.find(v => v.id === mid);
  if (!m) return;
  const mine = m.author === S.me.id;
  const items = [
    { label: 'Додати реакцію', icon: 'smile', action: function () { emojiMenu(x, y, em => toggleReaction(em, mid)); } },
    { label: 'Відповісти', icon: 'reply', action: function () { setReply(mid); } },
    { label: 'Скопіювати текст', icon: 'copy', action: function () { copyText(m.content || ''); } },
    { label: 'Скопіювати посилання', icon: 'link', action: function () { copyText(location.origin + '/#/channels/' + (S.view.serverId || '@me') + '/' + S.view.channelId + '/' + mid); } },
    { label: m.pinned ? 'Відкріпити' : 'Закріпити', icon: 'pin', action: function () { togglePin(mid); } }
  ];
  if (mine) items.push({ label: 'Редагувати', icon: 'pencil', action: function () { startEdit(mid); } });
  if (mine || canManageCurrent()) items.push({ label: 'Видалити', icon: 'trash', danger: true, action: function () { deleteMessage(mid); } });
  contextMenu(x, y, items);
}

function emojiMenu(x, y, cb) {
  const box = h('div', { class: 'emoji-pop' });
  EMOJI.slice(0, 48).forEach(function (e) {
    const b = h('button', { class: 'emoji-cell', type: 'button' });
    b.textContent = e;
    b.onclick = function () { pop.remove(); cb(e); };
    box.appendChild(b);
  });
  const pop = h('div', { class: 'popover emoji-popover' }, '');
  pop.appendChild(box);
  document.body.appendChild(pop);
  const r = pop.getBoundingClientRect();
  pop.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  pop.style.top = Math.max(8, y - r.height - 8) + 'px';
  const close = function (e) {
    if (pop.contains(e.target)) return;
    pop.remove();
    document.removeEventListener('mousedown', close, true);
  };
  setTimeout(() => document.addEventListener('mousedown', close, true), 0);
}

function copyText(t) {
  navigator.clipboard.writeText(t).then(function () { toast('Скопійовано', ''); },
    function () { toast('Не вдалося скопіювати', 'err'); });
}

function lightbox(src) {
  const ov = h('div', { class: 'lightbox' });
  const img = h('img', { src: src });
  ov.appendChild(img);
  ov.onclick = function () { ov.remove(); };
  document.body.appendChild(ov);
}

async function togglePin(mid) {
  try {
    const r = await api('POST', '/channels/' + S.view.channelId + '/messages/' + mid + '/pin', {});
    const c = S.cache[S.view.channelId];
    const m = c.messages.find(x => x.id === mid);
    if (m) { m.pinned = r.pinned; replaceMessageDom(m); }
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteMessage(mid) {
  try {
    await api('DELETE', '/channels/' + S.view.channelId + '/messages/' + mid, {});
  } catch (e) { toast(e.message, 'err'); }
}

/* ------------------------------------------------------- редактор ------- */

function setReply(mid) {
  const c = S.cache[S.view.channelId];
  const m = c && c.messages.find(x => x.id === mid);
  if (!m) return;
  composerState.replyTo = mid;
  composerState.editing = null;
  renderComposer();
  const ta = $('#composer textarea');
  if (ta) ta.focus();
}

function startEdit(mid) {
  const c = S.cache[S.view.channelId];
  const m = c && c.messages.find(x => x.id === mid);
  if (!m) return;
  composerState.editing = mid;
  composerState.replyTo = null;
  renderComposer();
  const ta = $('#composer textarea');
  if (ta) { ta.value = m.content || ''; ta.focus(); autoGrow(ta); }
}

function renderComposer() {
  const vc = viewChannel();
  const box = $('#composer');
  if (!box || !vc) return;
  if (vc.kind === 'server' && vc.channel.type === 'voice') { box.innerHTML = ''; return; }

  const maxLen = S.nitro ? 4000 : 2000;
  const placeholder = vc.kind === 'dm'
    ? 'Написати @' + ((dmOther(vc.dm) || {}).username || '...')
    : 'Написати в #' + vc.channel.name;

  let banner = '';
  if (composerState.editing) {
    banner = '<div class="composer-banner"><span>Редагування повідомлення</span>' +
      '<button class="link-btn" id="cancel-edit">Скасувати</button></div>';
  } else if (composerState.replyTo) {
    const c = S.cache[vc.channel.id];
    const m = c && c.messages.find(x => x.id === composerState.replyTo);
    const u = m ? (userById(m.author) || {}) : {};
    banner = '<div class="composer-banner"><span>Відповідь ' +
      esc((u.displayName || u.username || '')) + '</span>' +
      '<button class="link-btn" id="cancel-reply">Скасувати</button></div>';
  }

  box.innerHTML = banner +
    '<div class="composer-box">' +
    '<button class="attach" id="btn-attach" title="Файл">' + icon('plus', 20) + '</button>' +
    '<textarea rows="1" maxlength="' + maxLen + '" placeholder="' + esc(placeholder) + '"></textarea>' +
    '<div class="composer-tools">' +
    '<button class="icon-btn" id="btn-gift" title="Подарунок">' + icon('gift', 20) + '</button>' +
    '<button class="icon-btn" id="btn-gif" title="GIF">' + icon('gif', 20) + '</button>' +
    '<button class="icon-btn" id="btn-sticker" title="Стікери">' + icon('sticker', 20) + '</button>' +
    '<button class="icon-btn" id="btn-emoji" title="Емодзі">' + icon('smile', 20) + '</button>' +
    '</div></div>';

  const ta = box.querySelector('textarea');
  ta.oninput = function () { autoGrow(ta); sendTyping(); };
  ta.onkeydown = function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComposer(); }
    else if (e.key === 'Escape') { composerState = { replyTo: null, editing: null }; renderComposer(); }
  };
  $('#btn-attach').onclick = attachFile;
  $('#btn-emoji').onclick = function () {
    const r = this.getBoundingClientRect();
    emojiMenu(r.left, r.top, em => { ta.value += em; ta.focus(); autoGrow(ta); });
  };
  $('#btn-gift').onclick = function () { toast('Подарунки — незабаром ✨', ''); };
  $('#btn-gif').onclick = function () { toast('GIF — незабаром ✨', ''); };
  $('#btn-sticker').onclick = function () { toast('Стікери — незабаром ✨', ''); };
  const ce = $('#cancel-edit'); if (ce) ce.onclick = function () { composerState.editing = null; renderComposer(); };
  const cr = $('#cancel-reply'); if (cr) cr.onclick = function () { composerState.replyTo = null; renderComposer(); };
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
}

function sendTyping() {
  const now = Date.now();
  if (now - lastTypingSent < 2500) return;
  lastTypingSent = now;
  api('POST', '/channels/' + S.view.channelId + '/typing', {}).catch(function () {});
}

async function submitComposer() {
  const ta = $('#composer textarea');
  if (!ta) return;
  const text = ta.value.trim();
  if (!text && !composerState.editing) return;

  if (composerState.editing) {
    const mid = composerState.editing;
    composerState.editing = null;
    try {
      const r = await api('PATCH', '/channels/' + S.view.channelId + '/messages/' + mid, { content: text });
      const c = S.cache[S.view.channelId];
      const m = c && c.messages.find(x => x.id === mid);
      if (m) { m.content = r.message.content; m.edited = r.message.edited; replaceMessageDom(m); }
    } catch (e) { toast(e.message, 'err'); }
    renderComposer();
    return;
  }

  const replyTo = composerState.replyTo;
  const nonce = Math.random().toString(36).slice(2);
  composerState.replyTo = null;
  ta.value = '';
  autoGrow(ta);
  try {
    await api('POST', '/channels/' + S.view.channelId + '/messages',
      { content: text, replyTo: replyTo, nonce: nonce });
    playSound('message');
  } catch (e) { toast(e.message, 'err'); ta.value = text; }
  renderComposer();
}

function attachFile() {
  const inp = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  document.body.appendChild(inp);
  inp.onchange = async function () {
    const f = inp.files && inp.files[0];
    inp.remove();
    if (!f) return;
    const dataUrl = await compressImage(f, 1600);
    if (!dataUrl) return;
    const blob = await (await fetch(dataUrl)).blob();
    try {
      const r = await api('POST', '/upload', null, { type: blob.type, body: blob });
      await api('POST', '/channels/' + S.view.channelId + '/messages',
        { content: '', attachments: [{ url: r.url, name: f.name }] });
    } catch (e) { toast(e.message, 'err'); }
  };
  inp.click();
}

function compressImage(file, maxSide) {
  return new Promise(function (resolve) {
    const fr = new FileReader();
    fr.onload = function () {
      const img = new Image();
      img.onload = function () {
        let w = img.width, hgt = img.height;
        const scale = Math.min(1, maxSide / Math.max(w, hgt));
        w = Math.round(w * scale); hgt = Math.round(hgt * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = hgt;
        c.getContext('2d').drawImage(img, 0, 0, w, hgt);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { resolve(null); };
      img.src = fr.result;
    };
    fr.onerror = function () { resolve(null); };
    fr.readAsDataURL(file);
  });
}

/* --------------------------------------------------------- індикатор ---- */

function renderTyping() {
  const bar = $('#typing-bar');
  if (!bar || !S.view.channelId) return;
  const now = Date.now();
  const names = [];
  const t = S.typing[S.view.channelId] || {};
  Object.keys(t).forEach(function (uid) {
    if (uid === S.me.id) return;
    if (t[uid] > now) {
      const u = userById(uid);
      names.push(u ? (u.displayName || u.username) : 'Хтось');
    }
  });
  if (!names.length) { bar.innerHTML = ''; bar.classList.remove('show'); return; }
  bar.classList.add('show');
  const label = names.length === 1 ? names[0] + ' пише…' :
    names.length === 2 ? names[0] + ' і ' + names[1] + ' пишуть…' :
    'Кілька людей пишуть…';
  bar.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>' + esc(label);
}

function kickTypingRender() {
  renderTyping();
  clearTimeout(typingTimer);
  typingTimer = setTimeout(renderTyping, 7500);
}

/* ---------------------------------------------------- перехід до повідомлення */

async function jumpTo(channelId, mid) {
  if (S.view.channelId !== channelId) {
    const hash = S.view.type === 'dm' ? '#/channels/@me/' + channelId : '#/channels/' + S.view.serverId + '/' + channelId;
    navigate(hash);
    await new Promise(r => setTimeout(r, 60));
  }
  const c = S.cache[channelId];
  if (!c || !c.messages.some(m => m.id === mid)) {
    try {
      const r = await api('GET', '/channels/' + channelId + '/messages?around=' + mid + '&limit=50');
      (r.users || []).forEach(u => { S.users[u.id] = u; });
      S.cache[channelId] = { messages: r.messages || [], users: {}, done: false };
      renderMessages();
    } catch (e) {}
  }
  const box = $('#messages');
  const node = box && box.querySelector('.msg[data-id="' + mid + '"]');
  if (node) {
    node.scrollIntoView({ block: 'center' });
    node.classList.add('flash');
    setTimeout(() => node.classList.remove('flash'), 1600);
  }
}

/* ------------------------------------------------------------- пошук ----- */

let searchSeq = 0;

async function openSearch(q) {
  const panel = $('#search-panel');
  if (!panel) return;
  panel.classList.remove('hidden');
  const seq = ++searchSeq;
  panel.innerHTML = '<div class="search-head">Результати за «' + esc(q) + '»</div><div class="search-list">Пошук…</div>';
  const params = new URLSearchParams({ q: q });
  if (S.view.type === 'server') params.set('server', S.view.serverId);
  else if (S.view.type === 'dm') params.set('dm', S.view.dmId);
  try {
    const r = await api('GET', '/search?' + params.toString());
    if (seq !== searchSeq) return;
    (r.users || []).forEach(u => { S.users[u.id] = u; });
    renderSearchResults(r.messages || [], q);
  } catch (e) {
    panel.querySelector('.search-list').innerHTML = '<div class="muted pad">' + esc(e.message) + '</div>';
  }
}

function renderSearchResults(msgs, q) {
  const panel = $('#search-panel');
  if (!panel) return;
  let html = '<div class="search-head">Знайдено: ' + msgs.length + '</div><div class="search-list">';
  if (!msgs.length) html += '<div class="muted pad">Нічого не знайдено</div>';
  msgs.forEach(function (m) {
    const u = userById(m.author) || {};
    const chan = arenaName(m.channel);
    html += '<div class="search-hit" data-chan="' + m.channel + '" data-id="' + m.id + '">' +
      avatarHtml(u, 32) + '<div class="sh-body"><div class="sh-top">' +
      '<b>' + esc(u.displayName || u.username || '???') + '</b>' +
      (chan ? '<span class="sh-chan">#' + esc(chan) + '</span>' : '') +
      '<span class="sh-time">' + esc(fullTime(m.at)) + '</span></div>' +
      '<div class="sh-text">' + md(m.content) + '</div></div></div>';
  });
  html += '</div>';
  panel.innerHTML = html;
  panel.querySelectorAll('.search-hit').forEach(function (hit) {
    hit.onclick = function () { jumpTo(hit.dataset.chan, hit.dataset.id); };
  });
}

function closeSearch() {
  const panel = $('#search-panel');
  if (panel) { panel.classList.add('hidden'); panel.innerHTML = ''; }
}

/* --------------------------------------------------------- закріплені --- */

async function openPins() {
  try {
    const r = await api('GET', '/channels/' + S.view.channelId + '/pins');
    (r.users || []).forEach(u => { S.users[u.id] = u; });
    const body = h('div', { class: 'pins-list' });
    if (!r.messages.length) body.innerHTML = '<div class="muted pad">Немає закріплених повідомлень</div>';
    r.messages.forEach(function (m) {
      const u = userById(m.author) || {};
      const row = el('<div class="pin-item">' + avatarHtml(u, 36) +
        '<div class="pin-body"><div class="pin-top"><b>' + esc(u.displayName || u.username) +
        '</b><span class="muted"> ' + esc(fullTime(m.at)) + '</span></div>' +
        '<div class="pin-text">' + md(m.content) + '</div></div></div>');
      row.onclick = function () { closeModal(); jumpTo(m.channel, m.id); };
      body.appendChild(row);
    });
    openModal({ title: 'Закріплені повідомлення', body: body });
  } catch (e) { toast(e.message, 'err'); }
}

/* ------------------------------------------------------ голосовий екран -- */

let vcFull = false;
function setVoiceFull(on) {
  vcFull = !!on;
  document.body.classList.toggle('vc-full', vcFull);
}

function renderVoiceView(vc) {
  S._vc = vc;
  const col = $('#chat-col');
  if (!col) return;
  const connected = Voice.isIn(vc.channel.id);
  const members = Object.keys(S.presences).filter(id => {
    const p = S.presences[id];
    return p && p.voice && p.voice.channel === vc.channel.id;
  });
  let tiles = '';
  members.forEach(function (id) {
    const u = userById(id) || {};
    const p = S.presences[id] || {};
    const sharing = p.voice && p.voice.share;
    const name = esc(u.displayName || u.username || '???');
    if (sharing) {
      if (id === S.me.id && Voice.videoStreams.share) {
        tiles += '<div class="vtile sharing" data-speak="' + id + '"><video id="vs-tile-local" autoplay muted playsinline></video>' +
          '<div class="vtile-name">' + name + ' — демонстрація</div></div>';
      } else if (Voice.remoteVideo[id]) {
        tiles += '<div class="vtile sharing" data-speak="' + id + '"><video data-peer="' + id + '" autoplay playsinline></video>' +
          '<div class="vtile-name">' + name + ' — демонстрація</div></div>';
      } else {
        tiles += '<div class="vtile sharing pending" data-speak="' + id + '">' + avatarHtml(u, 64) +
          '<div class="vtile-name">' + name + ' — демонстрація</div></div>';
      }
    } else {
      tiles += '<div class="vtile" data-speak="' + id + '">' + avatarHtml(u, 72) +
        '<div class="vtile-name">' + name + '</div>' +
        (id === S.me.id ? '<div class="vtile-tag">Ви</div>' : '') + '</div>';
    }
  });
  if (!members.length) tiles = '<div class="muted pad">Порожньо — ще нікого</div>';

  /* список учасників у куті (видно у повноекранному режимі) */
  let people = '';
  members.forEach(function (id) {
    const u = userById(id) || {};
    const p = S.presences[id] || {};
    people += '<div class="vs-person">' + avatarHtml(u, 24) +
      '<span class="vs-pname">' + esc(u.displayName || u.username || '???') + '</span>' +
      (p.voice && p.voice.share ? '<span class="vs-pic" title="Демонстрація">' + icon('screen', 12) + '</span>' : '') +
      '<span class="vs-pic">' + icon((id === S.me.id && Voice.muted) ? 'micOff' : 'mic', 12) + '</span></div>';
  });

  const sharing = !!Voice.videoStreams.share;
  let actions;
  if (connected) {
    actions = '<div class="vs-actions">' +
      (sharing
        ? '<button class="btn danger" id="vs-share">' + icon('screenOff', 18) + ' Зупинити демонстрацію</button>'
        : '<button class="btn secondary" id="vs-share">' + icon('screen', 18) + ' Демонстрація екрана</button>') +
      '<button class="btn danger" id="vs-leave">' + icon('phoneOff', 18) + ' Від’єднатися</button>' +
      '</div>';
  } else {
    actions = '<button class="btn primary" id="vs-join">' + icon('speaker', 18) + ' Приєднатися до голосу</button>';
  }

  col.innerHTML = '<div id="voice-screen" class="' + (vcFull ? 'full' : '') + '">' +
    '<div class="vs-head">' + icon('speaker', 40) + '<h2>' + esc(vc.channel.name) + '</h2>' +
    '<p class="muted">' + members.length + ' учасник(ів)' + (connected ? ' · ви підключені' : '') + '</p></div>' +
    '<div class="vtiles">' + tiles + '</div>' +
    (people ? '<div class="vs-people">' + people + '</div>' : '') +
    actions +
    '<button class="vs-full-btn" id="vs-full" title="' + (vcFull ? 'Звичайний режим' : 'Повноекранний режим') + '">' +
    icon(vcFull ? 'minimize' : 'maximize', 18) + '</button>' +
    '</div>';

  setVoiceFull(vcFull);

  const lts = document.querySelector('#vs-tile-local');
  if (lts && Voice.videoStreams.share) { lts.srcObject = Voice.videoStreams.share; lts.play().catch(function () {}); }
  Array.prototype.forEach.call(document.querySelectorAll('#voice-screen video[data-peer]'), function (v) {
    const st = Voice.remoteVideo[v.getAttribute('data-peer')];
    if (st) { v.srcObject = st; v.play().catch(function () {}); }
  });

  const join = $('#vs-join');
  if (join) join.onclick = function () { Voice.join(vc.channel.id, vc.server.id); };
  const leave = $('#vs-leave');
  if (leave) leave.onclick = function () { Voice.leave(); };
  const share = $('#vs-share');
  if (share) share.onclick = function () { Voice.videoStreams.share ? Voice.stopVideo('share') : Voice.startVideo('share'); };
  const fb = $('#vs-full');
  if (fb) fb.onclick = function () { setVoiceFull(!vcFull); renderVoiceView(vc); };
}

/* Escape виходить із повноекранного режиму */
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && vcFull) {
    setVoiceFull(false);
    if (S._vc && document.getElementById('voice-screen')) renderVoiceView(S._vc);
  }
});

/* показ спойлерів по кліку */
document.addEventListener('click', function (e) {
  const s = e.target.closest && e.target.closest('.spoiler');
  if (s) s.classList.toggle('open');
});
