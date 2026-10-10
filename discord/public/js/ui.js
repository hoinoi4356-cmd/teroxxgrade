/* ui.js — дрібні утиліти: DOM, час, markdown, емодзі, модалки, меню, звук */
'use strict';

/* ------------------------------------------------------------- DOM ----- */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function h(tag, props, html) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    if (k === 'class') e.className = props[k];
    else if (k === 'text') e.textContent = props[k];
    else if (k === 'html') e.innerHTML = props[k];
    else if (k.startsWith('on') && typeof props[k] === 'function') e.addEventListener(k.slice(2), props[k]);
    else e.setAttribute(k, props[k]);
  }
  if (html != null) e.innerHTML = html;
  return e;
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

/* ------------------------------------------------------------- час ----- */

const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
}

function shortTime(ts) {
  const d = new Date(ts);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function fullTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const y = new Date(now.getTime() - 86400000);
  if (dayKey(ts) === dayKey(now.getTime())) return 'Сьогодні о ' + shortTime(ts);
  if (dayKey(ts) === dayKey(y.getTime())) return 'Вчора о ' + shortTime(ts);
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ' о ' + shortTime(ts);
}

function dateLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const y = new Date(now.getTime() - 86400000);
  if (dayKey(ts) === dayKey(now.getTime())) return 'Сьогодні';
  if (dayKey(ts) === dayKey(y.getTime())) return 'Вчора';
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

/* --------------------------------------------------------- markdown ----- */

const EMOJI_ONLY = /^(?:[\u2190-\u2bff\u2600-\u27bf\u2b00-\u2bff\ufe0f\u200d\u20e3\ud800-\udbff\udc00-\udfff\s]|\u2764|\u2764\ufe0f)+$/;

function md(text, opts) {
  opts = opts || {};
  let src = String(text == null ? '' : text);
  const blocks = [];
  /* багаторядковий код ```
     ... ``` */
  src = src.replace(/```([\s\S]*?)```/g, function (m, code) {
    blocks.push('<pre class="md-pre"><code>' + esc(code.replace(/^\n/, '')) + '</code></pre>');
    return '\u0000B' + (blocks.length - 1) + '\u0000';
  });

  src = esc(src);

  /* рядковий код */
  src = src.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>');
  /* посилання */
  src = src.replace(/https?:\/\/[^\s<]+/g, function (u) {
    return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>';
  });
  /* підкреслення __x__ (перед жирним) */
  src = src.replace(/__(.+?)__/g, '<u>$1</u>');
  /* жирний / курсив / закреслення */
  src = src.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  src = src.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>');
  src = src.replace(/~~(.+?)~~/g, '<s>$1</s>');
  /* спойлер */
  src = src.replace(/\|\|(.+?)\|\|/g, '<span class="spoiler" data-spoiler="1">$1</span>');
  /* згадки та канали */
  src = src.replace(/(^|[\s(])@(everyone|here)\b/g,
    '$1<span class="mention" data-mention="$2">@$2</span>');
  src = src.replace(/(^|[\s(])@([\w\u0400-\u04ff.\-]{2,32})/g,
    '$1<span class="mention" data-user="$2">@$2</span>');
  src = src.replace(/(^|[\s(])#([\w\u0400-\u04ff\-.]+)/g,
    '$1<span class="mention chan">#$2</span>');

  /* переноси */
  src = src.replace(/\n/g, '<br>');

  src = src.replace(/\u0000B(\d+)\u0000/g, function (m, i) { return blocks[+i]; });
  return src;
}

function isJumbo(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 30) return false;
  /* приблизна перевірка: лише емодзі та пробіли */
  const stripped = t.replace(EMOJI_ONLY, '');
  return stripped.length === 0;
}

/* ----------------------------------------------------------- емодзі ----- */

const EMOJI = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊',
  '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜',
  '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶',
  '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒',
  '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓',
  '🧐', '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨',
  '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱',
  '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '💩', '🤡', '👻', '👽', '🤖',
  '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🙈', '🙉', '🙊',
  '💋', '💌', '💘', '💝', '💖', '💗', '💓', '💞', '💕', '💟', '❣️', '💔',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💯', '💢', '💥',
  '💫', '💦', '💨', '🕳️', '💬', '👋', '🤚', '✋', '🖖', '👌', '🤌', '🤏',
  '✌️', '🤞', '👍', '👎', '👏', '🙌', '🤝', '🙏', '💪', '🦾', '🖕', '✍️',
  '🔥', '✨', '⭐', '🌟', '⚡', '☀️', '🌈', '☁️', '❄️', '🎉', '🎊', '🎈',
  '🎁', '🏆', '🥇', '🎯', '🎮', '🕹️', '🎲', '🎵', '🎶', '🎤', '🎧', '📢',
  '🍎', '🍕', '🍔', '🍟', '🍗', '🍣', '🍩', '🍪', '🎂', '🍰', '☕', '🍺',
  '🍻', '🥂', '🚀', '✈️', '🚗', '🏠', '🌍', '🌙', '⛅', '🐱', '🐶', '🦊'
];

/* ------------------------------------------------------------- аватари - */

function colorFromId(id) {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  const palette = ['#5865f2', '#3ba55d', '#faa81a', '#ed4245', '#eb459e',
    '#9b59b6', '#1abc9c', '#e67e22', '#3498db', '#e91e63'];
  return palette[n % palette.length];
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return String(name || '?').slice(0, 2).toUpperCase();
}

function avatarHtml(user, size, cls) {
  const s = size || 32;
  if (!user) return '<div class="avatar ' + (cls || '') + '" style="width:' + s + 'px;height:' + s +
    'px;background:#5865f2;font-size:' + Math.round(s * 0.4) + 'px">?</div>';
  if (user.avatar) {
    return '<img class="avatar ' + (cls || '') + '" src="' + user.avatar + '" style="width:' + s +
      'px;height:' + s + 'px" alt="">';
  }
  const bg = user.accent || colorFromId(user.id);
  return '<div class="avatar ' + (cls || '') + '" style="width:' + s + 'px;height:' + s +
    'px;background:' + bg + ';font-size:' + Math.round(s * 0.38) + 'px">' +
    esc(initials(user.displayName || user.username)) + '</div>';
}

function statusDot(userId) {
  const p = (S.presences && S.presences[userId]) || {};
  let st = p.state || 'offline';
  if (st === 'invisible') st = 'offline';
  return '<span class="status-dot st-' + st + '"></span>';
}

/* ------------------------------------------------------------- тости --- */

function toast(msg, kind) {
  let root = $('#toasts');
  if (!root) { root = h('div', { id: 'toasts' }); document.body.appendChild(root); }
  const t = el('<div class="toast ' + (kind || '') + '">' + esc(msg) + '</div>');
  root.appendChild(t);
  setTimeout(function () { t.classList.add('out'); }, 2600);
  setTimeout(function () { t.remove(); }, 3000);
}

/* ------------------------------------------------------------ модалки -- */

let modalStack = [];

function openModal(opts) {
  const backdrop = h('div', { class: 'modal-backdrop' + (opts.full ? ' full' : '') });
  const box = h('div', { class: 'modal ' + (opts.wide ? 'wide' : '') + (opts.full ? ' full' : '') });

  const head = h('div', { class: 'modal-head' });
  head.innerHTML = '<h3>' + esc(opts.title || '') + '</h3>';
  const close = h('button', { class: 'icon-btn', title: 'Закрити' });
  close.innerHTML = icon('x', 18);
  close.onclick = function () { closeModal(backdrop); };
  head.appendChild(close);

  const body = h('div', { class: 'modal-body' });
  if (typeof opts.body === 'string') body.innerHTML = opts.body;
  else if (opts.body) body.appendChild(opts.body);

  box.appendChild(head);
  box.appendChild(body);

  if (opts.actions) {
    const foot = h('div', { class: 'modal-foot' });
    opts.actions.forEach(function (a) {
      const b = h('button', { class: 'btn ' + (a.kind || 'secondary') });
      b.textContent = a.label;
      b.onclick = async function () {
        const res = a.onClick ? await a.onClick(body) : undefined;
        if (res !== false) closeModal(backdrop);
      };
      foot.appendChild(b);
    });
    box.appendChild(foot);
  } else {
    box.classList.add('no-foot');
  }

  backdrop.appendChild(box);
  backdrop.onmousedown = function (e) { if (e.target === backdrop) closeModal(backdrop); };
  ($('#overlays') || document.body).appendChild(backdrop);
  modalStack.push(backdrop);
  setTimeout(function () { const f = box.querySelector('input,textarea'); if (f) f.focus(); }, 30);
  return { backdrop: backdrop, body: body, close: function () { closeModal(backdrop); } };
}

function closeModal(backdrop) {
  const b = backdrop || modalStack[modalStack.length - 1];
  if (!b) return;
  b.remove();
  modalStack = modalStack.filter(x => x !== b);
}

function confirmBox(title, text, onYes) {
  openModal({
    title: title,
    body: '<p class="muted">' + esc(text) + '</p>',
    actions: [
      { label: 'Скасувати', kind: 'secondary' },
      { label: 'Так', kind: 'danger', onClick: onYes }
    ]
  });
}

/* ------------------------------------------------------- контекст-меню -- */

function contextMenu(x, y, items) {
  $$('.ctx-menu').forEach(m => m.remove());
  const menu = h('div', { class: 'ctx-menu' });
  items.forEach(function (it) {
    if (it.separator) { menu.appendChild(h('div', { class: 'ctx-sep' })); return; }
    const row = h('button', { class: 'ctx-item ' + (it.danger ? 'danger' : '') });
    row.innerHTML = (it.icon ? icon(it.icon, 18) : '<span class="ctx-i"></span>') +
      '<span>' + esc(it.label) + '</span>';
    row.onclick = function () {
      menu.remove();
      if (it.action) it.action();
    };
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  let left = Math.min(x, window.innerWidth - r.width - 6);
  let top = Math.min(y, window.innerHeight - r.height - 6);
  menu.style.left = Math.max(6, left) + 'px';
  menu.style.top = Math.max(6, top) + 'px';

  const close = function (e) {
    if (menu.contains(e.target)) return;
    menu.remove();
    document.removeEventListener('mousedown', close, true);
    window.removeEventListener('blur', close);
  };
  setTimeout(function () {
    document.addEventListener('mousedown', close, true);
    window.addEventListener('blur', close);
  }, 0);
}

/* ------------------------------------------------------------ дропдаун - */

function dropdown(anchor, items) {
  const r = anchor.getBoundingClientRect();
  const menu = h('div', { class: 'ctx-menu dropdown' });
  items.forEach(function (it) {
    if (it.separator) { menu.appendChild(h('div', { class: 'ctx-sep' })); return; }
    const row = h('button', { class: 'ctx-item ' + (it.danger ? 'danger' : '') });
    row.innerHTML = (it.icon ? icon(it.icon, 18) : '<span class="ctx-i"></span>') +
      '<span>' + esc(it.label) + '</span>' +
      (it.hint ? '<span class="ctx-hint">' + esc(it.hint) + '</span>' : '');
    row.onclick = function () { menu.remove(); if (it.action) it.action(); };
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  const mr = menu.getBoundingClientRect();
  menu.style.left = Math.max(6, Math.min(r.left, window.innerWidth - mr.width - 6)) + 'px';
  menu.style.top = Math.min(r.bottom + 4, window.innerHeight - mr.height - 6) + 'px';
  const close = function (e) {
    if (menu.contains(e.target) || anchor.contains(e.target)) return;
    menu.remove();
    document.removeEventListener('mousedown', close, true);
  };
  setTimeout(function () { document.addEventListener('mousedown', close, true); }, 0);
}

/* --------------------------------------------------------------- звук -- */

let audioCtx = null;
const SFX = { enabled: true, volume: 0.6 };
try {
  const saved = JSON.parse(localStorage.getItem('dc_sfx') || '{}');
  if (typeof saved.enabled === 'boolean') SFX.enabled = saved.enabled;
  if (typeof saved.volume === 'number') SFX.volume = saved.volume;
} catch (e) { /* ignore */ }
function saveSfx() { try { localStorage.setItem('dc_sfx', JSON.stringify(SFX)); } catch (e) { /* ignore */ } }

function ac() {
  if (!audioCtx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (C) audioCtx = new C();
  }
  return audioCtx;
}

/* Оригінальні синтезовані звуки у стилі Discord (без чужих аудіофайлів). */
function sfxTone(ctx, o) {
  const t0 = ctx.currentTime + (o.at || 0);
  const dur = o.dur || 0.15;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
  const peak = Math.max(0.0002, (o.gain == null ? 0.18 : o.gain) * SFX.volume);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack || 0.008));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.03);
}

/* Звукові файли (за бажанням користувача) для ключових подій. */
const SFX_FILES = {
  notification: '/audio/notification.mp3', /* вхідне повідомлення */
  mention: '/audio/notification.mp3',
  join: '/audio/connect.mp3',               /* підключення до голосу */
  leave: '/audio/leave.mp3',                /* вихід з голосового каналу */
  call: '/audio/calling.mp3',               /* вихідний дзвінок */
  mute: '/audio/mute.wav',                  /* мікрофон вимкнено */
  unmute: '/audio/unmute.wav',              /* мікрофон увімкнено */
  shareOn: '/audio/share-on.wav',           /* початок демонстрації екрана */
  shareOff: '/audio/share-off.wav'          /* кінець демонстрації екрана */
};

function playSample(url) {
  try {
    const a = new Audio(url);
    a.volume = Math.max(0, Math.min(1, SFX.volume));
    const p = a.play();
    if (p && p.catch) p.catch(function () {});
  } catch (e) { /* ignore */ }
}

function playSound(kind) {
  if (!SFX.enabled) return;
  if (SFX_FILES[kind]) { playSample(SFX_FILES[kind]); return; }
  const ctx = ac();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  switch (kind) {
    case 'message':                                   /* своє повідомлення надіслано */
      sfxTone(ctx, { type: 'triangle', freq: 620, to: 480, dur: 0.09, gain: 0.12 }); break;
    case 'notification':                              /* нове повідомлення в чаті */
      sfxTone(ctx, { type: 'sine', freq: 784, dur: 0.13, gain: 0.16, attack: 0.006 });
      sfxTone(ctx, { type: 'sine', freq: 1175, at: 0.085, dur: 0.17, gain: 0.13 }); break;
    case 'mention':                                   /* згадка/особисте */
      sfxTone(ctx, { type: 'sine', freq: 659, dur: 0.1, gain: 0.15 });
      sfxTone(ctx, { type: 'sine', freq: 880, at: 0.08, dur: 0.1, gain: 0.14 });
      sfxTone(ctx, { type: 'sine', freq: 1319, at: 0.16, dur: 0.18, gain: 0.12 }); break;
    case 'join':                                      /* ти зайшов у голосовий */
      sfxTone(ctx, { type: 'sine', freq: 392, dur: 0.12, gain: 0.16 });
      sfxTone(ctx, { type: 'sine', freq: 587, at: 0.09, dur: 0.2, gain: 0.14 }); break;
    case 'leave':                                     /* ти вийшов з голосового */
      sfxTone(ctx, { type: 'sine', freq: 587, dur: 0.12, gain: 0.14 });
      sfxTone(ctx, { type: 'sine', freq: 392, at: 0.09, dur: 0.2, gain: 0.12 }); break;
    case 'userJoin':                                  /* хтось зайшов у канал */
      sfxTone(ctx, { type: 'sine', freq: 880, dur: 0.1, gain: 0.13 });
      sfxTone(ctx, { type: 'sine', freq: 1319, at: 0.07, dur: 0.1, gain: 0.08 }); break;
    case 'userLeave':                                 /* хтось вийшов з каналу */
      sfxTone(ctx, { type: 'sine', freq: 660, to: 440, dur: 0.13, gain: 0.11 }); break;
    case 'mute':
      sfxTone(ctx, { type: 'square', freq: 300, dur: 0.05, gain: 0.07 }); break;
    case 'unmute':
      sfxTone(ctx, { type: 'square', freq: 520, dur: 0.05, gain: 0.07 }); break;
    case 'deafen':
      sfxTone(ctx, { type: 'square', freq: 240, dur: 0.05, gain: 0.07 });
      sfxTone(ctx, { type: 'square', freq: 190, at: 0.06, dur: 0.05, gain: 0.07 }); break;
    case 'undeafen':
      sfxTone(ctx, { type: 'square', freq: 420, dur: 0.05, gain: 0.07 });
      sfxTone(ctx, { type: 'square', freq: 560, at: 0.06, dur: 0.05, gain: 0.07 }); break;
    case 'call':                                      /* вхідний дзвінок (повторюється) */
      sfxTone(ctx, { type: 'sine', freq: 523, dur: 0.4, gain: 0.12 });
      sfxTone(ctx, { type: 'sine', freq: 659, at: 0.45, dur: 0.4, gain: 0.12 }); break;
    default:
      sfxTone(ctx, { type: 'sine', freq: 600, dur: 0.1, gain: 0.12 });
  }
}

/* --------------------------------------------------------------- теми -- */

const THEMES = [
  { id: 'classic',   name: 'Класична',          prev: 'linear-gradient(135deg,#1e1f22,#313338 60%,#5865f2)' },
  { id: 'amoled',    name: 'AMOLED',            prev: 'linear-gradient(135deg,#000,#111 60%,#5865f2)' },
  { id: 'blurple',   name: 'Midnight Blurple',  prev: 'linear-gradient(135deg,#0a0a12,#141428 55%,#8b5cf6)' },
  { id: 'chroma',    name: 'Chroma Glow',       prev: 'linear-gradient(135deg,#0d0616,#2a0f4d 50%,#8b00ff 75%,#39ff14)' },
  { id: 'amethyst',  name: 'Аметистовий дзен',  prev: 'linear-gradient(135deg,#1a0f2e,#361e60 55%,#e879f9)' },
  { id: 'eco',       name: 'Еко',               prev: 'linear-gradient(135deg,#0d1a12,#1c3d28 55%,#a3e635)' },
  { id: 'cocoa',     name: 'Затишне какао',     prev: 'linear-gradient(135deg,#241a15,#3f2d22 55%,#e0a96d)' },
  { id: 'raincloud', name: 'Retro Raincloud',   prev: 'linear-gradient(135deg,#b9bfcb,#cdd2dc 60%,#b9a6d8)' },
  { id: 'citrus',    name: 'Citrus Sherbert',   prev: 'linear-gradient(135deg,#ffd166,#ff9f68 55%,#ff6f91)' },
  { id: 'midnight',  name: 'Північ',            prev: 'linear-gradient(135deg,#0a1120,#12203a 55%,#22d3ee)' },
  { id: 'ocean',     name: 'Океан',             prev: 'linear-gradient(135deg,#052e3a,#0a4a5e 55%,#22d3a7)' },
  { id: 'forest',    name: 'Ліс',               prev: 'linear-gradient(135deg,#0c1f16,#163a26 55%,#84cc16)' },
  { id: 'synthwave', name: 'Синтвейв',          prev: 'linear-gradient(135deg,#160b2b,#341765 55%,#00e0ff)' },
  { id: 'sunset',    name: 'Захід сонця',       prev: 'linear-gradient(135deg,#2a1330,#52203f 55%,#ff8a00)' },
  { id: 'crimson',   name: 'Багряна',           prev: 'linear-gradient(135deg,#1a0a0d,#3a151d 55%,#f59e0b)' },
  { id: 'light',     name: 'Світла',            prev: 'linear-gradient(135deg,#f2f3f5,#ffffff 60%,#5865f2)' }
];

function currentTheme() {
  try { return localStorage.getItem('dc_theme') || 'classic'; } catch (e) { return 'classic'; }
}

function themeName(id) {
  const t = THEMES.filter(function (x) { return x.id === id; })[0];
  return t ? t.name : id;
}

function applyTheme(id, silent) {
  id = id || 'classic';
  const root = document.documentElement;
  if (id === 'classic') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', id);
  try { localStorage.setItem('dc_theme', id); } catch (e) { /* ignore */ }
  if (!silent && typeof toast === 'function') toast('Тема: ' + themeName(id));
}

function themeCardsHtml() {
  const cur = currentTheme();
  return THEMES.map(function (t) {
    return '<div class="theme-card' + (t.id === cur ? ' active' : '') + '" data-theme="' + t.id + '">' +
      '<div class="tc-prev" style="background:' + t.prev + '"></div>' +
      '<div class="tc-name"><span>' + t.name + '</span>' +
      (t.id === cur ? '<span class="tc-check">✓</span>' : '') + '</div></div>';
  }).join('');
}

/* застосовуємо збережену тему одразу при завантаженні */
applyTheme(currentTheme(), true);

/* --------------------------------------------------- фон чату (Background) - */
const BG_PRESETS = [
  { id: 'none',      name: 'Без фону',       img: '' },
  { id: 'purred',    name: 'Пурпурно-червоний', img: 'linear-gradient(135deg,#6d28d9 0%,#a21caf 35%,#be185d 65%,#dc2626 100%)' },
  { id: 'firework',  name: 'Салют',          img: 'radial-gradient(circle at 22% 26%, rgba(255,80,60,.85) 0 9px, transparent 11%), radial-gradient(circle at 35% 22%, rgba(255,190,80,.8) 0 7px, transparent 10%), radial-gradient(circle at 29% 36%, rgba(255,120,70,.7) 0 8px, transparent 11%), radial-gradient(circle at 72% 24%, rgba(255,60,40,.85) 0 10px, transparent 12%), radial-gradient(circle at 85% 33%, rgba(255,200,70,.8) 0 8px, transparent 10%), radial-gradient(circle at 77% 40%, rgba(255,110,50,.7) 0 9px, transparent 11%), radial-gradient(300px 200px at 50% 68%, rgba(255,90,50,.4), transparent 70%), linear-gradient(180deg,#200812 0%,#360d16 55%,#4c1520 100%)' },
  { id: 'aurora',    name: 'Полярне сяйво',  img: 'linear-gradient(135deg,#3b2a6b 0%,#7b2a5b 40%,#2a4a6b 75%,#0b1026 100%)' },
  { id: 'cyber',     name: 'Неоновий кіберпанк', img: 'radial-gradient(600px 400px at 20% 30%, rgba(139,0,255,.8), transparent 70%), radial-gradient(500px 380px at 80% 20%, rgba(0,229,255,.65), transparent 70%), linear-gradient(140deg,#0a0614,#170b2e 55%,#2b1045)' },
  { id: 'space',     name: 'Космос',         img: 'radial-gradient(circle at 25% 25%, rgba(120,81,169,.55), transparent 45%), radial-gradient(circle at 80% 70%, rgba(59,130,246,.4), transparent 45%), radial-gradient(circle at 60% 15%, rgba(236,72,153,.35), transparent 40%), linear-gradient(160deg,#05060f,#0b0f2a 60%,#0e1220)' },
  { id: 'forest',    name: 'Лісовий туман',  img: 'radial-gradient(700px 500px at 75% 80%, rgba(34,197,94,.25), transparent 70%), linear-gradient(160deg,#0a1a12,#123020 55%,#1d3b26)' },
  { id: 'ocean',     name: 'Глибина океану', img: 'radial-gradient(600px 400px at 70% 20%, rgba(34,211,238,.3), transparent 70%), linear-gradient(160deg,#02212e,#06455a 55%,#083a4c)' },
  { id: 'sunset',    name: 'Схід сонця',     img: 'radial-gradient(700px 500px at 80% 10%, rgba(255,138,0,.4), transparent 70%), radial-gradient(600px 400px at 20% 80%, rgba(255,61,129,.3), transparent 70%), linear-gradient(160deg,#2a1330,#52203f 55%,#7a2a3f)' },
  { id: 'sand',      name: 'Піски',          img: 'linear-gradient(160deg,#3a2f1d,#5c4a28 55%,#7a6134)' },
  { id: 'blurple',   name: 'Blurple mesh',   img: 'radial-gradient(800px 500px at 30% 20%, rgba(88,101,242,.45), transparent 65%), radial-gradient(600px 400px at 80% 75%, rgba(139,92,246,.4), transparent 65%), linear-gradient(160deg,#0e0e1c,#171a33 60%,#1d2140)' }
];

function currentBg() {
  try { return JSON.parse(localStorage.getItem('dc_bg') || '{}'); } catch (e) { return {}; }
}
function saveBg(bg) { try { localStorage.setItem('dc_bg', JSON.stringify(bg)); } catch (e) { /* ignore */ } }

function applyBg(bg) {
  bg = bg || currentBg();
  const el = document.body;
  if (!bg.img) {
    el.classList.remove('has-bg');
    el.style.removeProperty('--bg-img');
    el.style.removeProperty('--bg-alpha-p');
    return;
  }
  el.classList.add('has-bg');
  el.style.setProperty('--bg-img', String(bg.img));
  el.style.setProperty('--bg-alpha-p', (bg.opacity == null ? 55 : bg.opacity) + '%');
}

function bgCardsHtml() {
  const cur = currentBg();
  return BG_PRESETS.map(function (p) {
    const on = !!p.img && cur.img === p.img;
    return '<div class="bg-card' + (on ? ' active' : '') + '" data-bg="' + p.id + '">' +
      '<div class="bg-prev' + (p.img ? '' : ' none') + '"' + (p.img ? ' style="background:' + p.img + '"' : '') + '></div>' +
      '<div class="bg-name">' + p.name + '</div></div>';
  }).join('');
}

/* фон чіпляється після створення каркаса */
applyBg(currentBg());

/* ------------------------------------------------------ робота з фото -- */

function pickImage(maxSize, cb) {
  const inp = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  document.body.appendChild(inp);
  inp.onchange = function () {
    const f = inp.files && inp.files[0];
    inp.remove();
    if (!f) return;
    const fr = new FileReader();
    fr.onload = function () {
      const img = new Image();
      img.onload = function () {
        const canvas = document.createElement('canvas');
        canvas.width = maxSize; canvas.height = maxSize;
        const g = canvas.getContext('2d');
        const side = Math.min(img.width, img.height);
        g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, maxSize, maxSize);
        cb(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(f);
  };
  inp.click();
}

/* --------------------------------------------------------- тултіпи -- */

let tipEl = null;
function moveTip(target) {
  if (!tipEl) { tipEl = h('div', { class: 'tooltip' }); document.body.appendChild(tipEl); }
  tipEl.textContent = target.getAttribute('data-tip');
  tipEl.style.display = 'block';
  const r = target.getBoundingClientRect();
  const tr = tipEl.getBoundingClientRect();
  let left = r.left + r.width / 2 - tr.width / 2;
  left = Math.max(6, Math.min(left, window.innerWidth - tr.width - 6));
  let top = r.top - tr.height - 8;
  if (top < 6) top = r.bottom + 8;
  tipEl.style.left = left + 'px';
  tipEl.style.top = top + 'px';
}
function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

/* Перетворює рідні title="..." на стилізовані підказки у стилі Discord. */
function initTips() {
  const convert = function (root) {
    const list = root && root.querySelectorAll ? root.querySelectorAll('[title]') : [];
    list.forEach(function (n) {
      const v = n.getAttribute('title');
      if (v) { n.setAttribute('data-tip', v); n.removeAttribute('title'); }
    });
  };
  document.addEventListener('mouseover', function (e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (t) moveTip(t); else hideTip();
  });
  document.addEventListener('scroll', hideTip, true);
  document.addEventListener('mousedown', hideTip, true);
  convert(document.documentElement);
  new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      (m.addedNodes || []).forEach(function (n) {
        if (!n || n.nodeType !== 1) return;
        if (n.hasAttribute && n.hasAttribute('title')) {
          const v = n.getAttribute('title');
          if (v) { n.setAttribute('data-tip', v); n.removeAttribute('title'); }
        }
        convert(n);
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
}
document.addEventListener('DOMContentLoaded', initTips);
