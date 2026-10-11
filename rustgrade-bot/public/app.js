'use strict';

const mapEl = document.getElementById('map');
const imgEl = document.getElementById('mapimg');
const overlayEl = document.getElementById('overlay');
const emptyEl = document.getElementById('empty');
const teamEl = document.getElementById('team');
const eventsEl = document.getElementById('events');
const deathsEl = document.getElementById('deaths');
const notesEl = document.getElementById('notes');
const nameEl = document.getElementById('serverName');
const popEl = document.getElementById('pop');
const wipeEl = document.getElementById('wipe');
const updatedEl = document.getElementById('updated');
const statsEl = document.getElementById('stats');
const peopleEl = document.getElementById('people');
const peopleCountEl = document.getElementById('peopleCount');
const popChartEl = document.getElementById('popchart');
const pcardEl = document.getElementById('pcard');

// Последнее состояние с сервера — нужно для карточки игрока по клику.
let lastState = null;
let activeSteamId = null;

// Геометрія карти з сервера (розмір зображення, відступ океану, розмір світу).
// Rust+ віддає зображення, де ігрова зона вписана з відступом oceanMargin,
// тому лінійне масштабування "від краю до краю" дає зсув — треба враховувати відступ.
let geom = null;

function clampPct(v) {
  return Math.max(0, Math.min(100, v));
}

// Світові координати Rust -> відсотки на зображенні карти.
// Світ: X росте на схід, Y росте на північ. Картинка: північ вгорі, Y вниз.
function worldToPct(wx, wy) {
  const g = geom;
  if (!g || !g.W || !g.H || !g.size) return { left: 0, top: 0 };
  const margin = g.margin || 0;
  const scaleX = (g.W - 2 * margin) / g.size;
  const scaleY = (g.H - 2 * margin) / g.size;
  const px = wx * scaleX + margin;
  const py = g.H - (wy * scaleY + margin); // дзеркалимо Y (північ угорі)
  return { left: clampPct((px / g.W) * 100), top: clampPct((py / g.H) * 100) };
}

const GRID_DIAMETER = 146.28571428571428;
const GRID_LETTERS = (() => {
  const single = [];
  for (let c = 0; c < 26; c++) single.push(String.fromCharCode(65 + c));
  const double = [];
  for (const a of single) for (const b of single) double.push(a + b);
  return single.concat(double);
})();

function gridLabel(x, y, mapSize) {
  const size = Number(mapSize) || 0;
  const col = Math.max(0, Math.floor((Number(x) || 0) / GRID_DIAMETER));
  const row = Math.max(0, Math.floor((size - (Number(y) || 0)) / GRID_DIAMETER));
  return `${GRID_LETTERS[col] || col}${row}`;
}

function agoText(ts) {
  if (!ts) return '—';
  const d = Math.round((Date.now() - ts) / 1000);
  if (d < 60) return 'только что';
  if (d < 3600) return `${Math.floor(d / 60)} мин назад`;
  if (d < 86400) return `${Math.floor(d / 3600)} ч назад`;
  return `${Math.floor(d / 86400)} д назад`;
}

function wipeText(ts) {
  if (!ts) return 'вайп —';
  const days = Math.floor((Date.now() / 1000 - ts) / 86400);
  return `вайп ${days}д`;
}

function dot(cls, leftPct, topPct, label, onClick) {
  const d = document.createElement('div');
  d.className = 'dot ' + cls;
  d.style.left = leftPct + '%';
  d.style.top = topPct + '%';
  if (onClick) {
    d.style.cursor = 'pointer';
    d.addEventListener('click', onClick);
  }
  if (label) {
    d.title = label;
    const l = document.createElement('span');
    l.className = 'dotlabel';
    l.textContent = label;
    l.style.left = leftPct + '%';
    l.style.top = topPct + '%';
    overlayEl.appendChild(l);
  }
  overlayEl.appendChild(d);
}

// Следы перемещения тиммейтов (polyline в SVG поверх карты).
function drawTrails(team) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'trails');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  let any = false;
  (team || []).forEach((m) => {
    const path = m.path || [];
    if (path.length < 2) return;
    const pts = path
      .map((pt) => {
        const p = worldToPct(Number(pt.x), Number(pt.y));
        return `${p.left},${p.top}`;
      })
      .join(' ');
    const poly = document.createElementNS(ns, 'polyline');
    poly.setAttribute('points', pts);
    poly.setAttribute('class', 'trail' + (m.isOnline ? '' : ' off') + (String(m.steamId) === String(activeSteamId) ? ' active' : ''));
    poly.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(poly);
    any = true;
  });
  if (any) overlayEl.appendChild(svg);
}

function showCard(steamId) {
  if (!pcardEl) return;
  if (String(activeSteamId) === String(steamId)) {
    activeSteamId = null;
    pcardEl.hidden = true;
    return;
  }
  activeSteamId = steamId;
  const s = lastState || {};
  const mapSize = s.mapSize || 0;
  const team = (s.team || []).find((m) => String(m.steamId) === String(steamId));
  const an = (s.analytics && s.analytics.members || []).find((m) => String(m.steamId) === String(steamId));
  const name = (team && team.name) || (an && an.name) || steamId;
  const avatar = (team && team.avatar) || (an && an.avatar) || '';
  const hours = team && team.rustHours != null ? team.rustHours : (an && an.steamHours != null ? an.steamHours : null);

  const rows = [];
  const online = (team && team.isOnline) || (an && an.online);
  rows.push(`${online ? '🟢 в игре' : '⚫ офлайн'}${team && !team.isAlive ? ' ☠ мёртв' : ''}${team && team.isLeader ? ' ★ лидер' : ''}`);
  if (hours != null) rows.push(`🎮 Rust в Steam: <b>${Math.round(hours).toLocaleString('ru-RU')} ч</b>`);
  if (an) {
    rows.push(`⏱️ Наиграно за вайп: <b>${fmtDur(an.onlineSeconds)}</b>`);
    rows.push(`🔁 Сессий: <b>${an.sessions}</b> • ☠️ Смертей: <b>${an.deaths}</b>`);
    rows.push(`👀 Последний раз: ${an.online ? 'сейчас' : agoText(an.lastSeen)}`);
    const lastPos = an.lastPos;
    if (lastPos && mapSize) {
      rows.push(`📍 ${an.online ? 'Сейчас' : 'Был'}: квадрат <b>${gridLabel(lastPos.x, lastPos.y, mapSize)}</b> (${Math.round(lastPos.x)}, ${Math.round(lastPos.y)})`);
    }
    if (an.lastDeath && mapSize) {
      rows.push(`💀 Последняя смерть: <b>${gridLabel(an.lastDeath.x, an.lastDeath.y, mapSize)}</b> — ${agoText(an.lastDeath.t)}`);
    }
    if (an.path && an.path.length > 2) {
      rows.push(`🧭 Точек маршрута: <b>${an.path.length}</b>`);
    }
  }
  pcardEl.innerHTML =
    `<div class="pcard-h"><img src="${escapeHtml(avatar)}" alt="" onerror="this.style.display='none'"/><b>${escapeHtml(name)}</b><span class="x">✕</span></div>` +
    `<div class="pcard-b">${rows.join('<br>')}</div>` +
    `<div class="pcard-f"><a href="https://steamcommunity.com/profiles/${encodeURIComponent(steamId)}" target="_blank" rel="noopener">Открыть Steam</a>${an && an.path && an.path.length > 1 ? ' • маршрут подсвечен' : ''}</div>`;
  pcardEl.hidden = false;
  pcardEl.querySelector('.x').addEventListener('click', () => {
    activeSteamId = null;
    pcardEl.hidden = true;
    tick();
  });
}

function renderTeam(team, size) {
  teamEl.innerHTML = '';
  if (!team.length) {
    teamEl.innerHTML = '<li class="off">Нет данных о команде</li>';
    return;
  }
  team.forEach((m) => {
    const p = worldToPct(Number(m.x), Number(m.y));
    const cls = !m.isOnline ? 'team-offline' : (m.isAlive ? 'team-online' : 'team-dead');
    dot(cls, p.left, p.top, m.name, () => showCard(m.steamId));
    const li = document.createElement('li');
    li.className = (m.isOnline ? '' : 'off') + (String(m.steamId) === String(activeSteamId) ? ' active' : '');
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => showCard(m.steamId));
    const av = m.avatar
      ? `<img class="av" src="${escapeHtml(m.avatar)}" alt="" onerror="this.style.display='none'" />`
      : '';
    const hours = m.rustHours != null ? ` · 🎮${Math.round(m.rustHours)}ч` : '';
    li.innerHTML = `<span class="who">${av}${m.isLeader ? '★ ' : ''}${escapeHtml(m.name)}</span><span class="tag">${m.isOnline ? (m.isAlive ? 'online' : 'dead') : 'offline'}${hours}</span>`;
    teamEl.appendChild(li);
  });
}

function renderEvents(markers, size) {
  eventsEl.innerHTML = '';
  if (!markers.length) {
    eventsEl.innerHTML = '<li class="off">Событий нет (Rust+ их больше не передаёт)</li>';
    return;
  }
  markers.forEach((m) => {
    const p = worldToPct(Number(m.x), Number(m.y));
    const title = `${m.emoji ? m.emoji + ' ' : ''}${m.label} ${m.grid}`;
    dot('event', p.left, p.top, title);
    const li = document.createElement('li');
    li.innerHTML = `<span>${m.emoji ? m.emoji + ' ' : ''}${escapeHtml(m.label)}</span><span class="tag">${m.grid}</span>`;
    eventsEl.appendChild(li);
  });
}

function renderDeaths(deaths) {
  deathsEl.innerHTML = '';
  if (!deaths.length) {
    deathsEl.innerHTML = '<li class="off">Смертей не было</li>';
    return;
  }
  deaths.slice().reverse().forEach((d) => {
    const p = worldToPct(Number(d.x), Number(d.y));
    dot('death', p.left, p.top, `☠ ${d.name} ${d.grid}`);
    const li = document.createElement('li');
    const mins = Math.max(0, Math.round((Date.now() - d.at) / 60000));
    li.innerHTML = `<span>⚠ ${escapeHtml(d.name)}</span><span class="tag">${d.grid} · ${mins}м</span>`;
    deathsEl.appendChild(li);
  });
}

function renderNotes(notes) {
  notesEl.innerHTML = '';
  if (!notes.length) {
    notesEl.innerHTML = '<li class="off">Меток нет</li>';
    return;
  }
  notes.forEach((n) => {
    const p = worldToPct(Number(n.x), Number(n.y));
    const who = n.by === 'leader' ? 'метка лидера' : 'метка команды';
    dot('note', p.left, p.top, `📍 ${who} ${n.grid}`);
    const li = document.createElement('li');
    li.innerHTML = `<span>📍 ${who}</span><span class="tag">${n.grid}</span>`;
    notesEl.appendChild(li);
  });
}

function fmtDur(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}ч ${m}м`;
  if (m) return `${m}м`;
  return `${s}с`;
}

function renderStats(members) {
  statsEl.innerHTML = '';
  if (!members || !members.length) {
    statsEl.innerHTML = '<li class="off">Пока нет данных</li>';
    return;
  }
  members.slice(0, 8).forEach((m, i) => {
    const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
    const li = document.createElement('li');
    li.className = m.online ? '' : 'off';
    const games = m.steamHours != null ? ` · 🎮${Math.round(m.steamHours)}ч` : '';
    li.innerHTML = `<span>${medal} ${escapeHtml(m.name)}</span><span class="tag">${fmtDur(m.onlineSeconds)} · ☠${m.deaths}${games}</span>`;
    statsEl.appendChild(li);
  });
}

function renderPeople(people) {
  peopleEl.innerHTML = '';
  if (peopleCountEl) peopleCountEl.textContent = String((people || []).length);
  if (!people || !people.length) {
    peopleEl.innerHTML = '<li class="off">Пока никого</li>';
    return;
  }
  people.forEach((p) => {
    const li = document.createElement('li');
    li.className = p.online ? '' : 'off';
    const mins = p.online ? 0 : Math.max(0, Math.round((Date.now() - p.lastSeen) / 60000));
    const last = p.online ? 'сейчас' : (mins < 60 ? `${mins}м` : mins < 1440 ? `${Math.round(mins / 60)}ч` : `${Math.round(mins / 1440)}д`);
    const extra = `${p.chats ? ` 💬${p.chats}` : ''}${p.deaths ? ` ☠${p.deaths}` : ''}`;
    li.innerHTML = `<span>${p.online ? '🟢' : '⚫'} ${escapeHtml(p.name)}</span><span class="tag">${last}${extra}</span>`;
    peopleEl.appendChild(li);
  });
}

function drawPop(history, current, peak) {
  const c = popChartEl;
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || 260;
  const h = 60;
  c.width = w * dpr;
  c.height = h * dpr;
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // подпись
  ctx.fillStyle = '#8b949e';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(`сейчас ${current || 0} · пик ${peak || 0}`, 4, 12);

  const pts = history || [];
  if (pts.length < 2) return;
  const maxP = Math.max(peak || 0, ...pts.map((p) => p.p), 1);
  const pad = 4;
  const cw = w - pad * 2;
  const chh = h - 20;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t || t0 + 1;
  const x = (t) => pad + (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * cw);
  const y = (p) => 16 + chh - (p / maxP) * chh;

  ctx.beginPath();
  ctx.moveTo(x(pts[0].t), y(pts[0].p));
  for (const p of pts) ctx.lineTo(x(p.t), y(p.p));
  ctx.strokeStyle = '#58a6ff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.lineTo(x(pts[pts.length - 1].t), 16 + chh);
  ctx.lineTo(x(pts[0].t), 16 + chh);
  ctx.closePath();
  ctx.fillStyle = 'rgba(88,166,255,0.15)';
  ctx.fill();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function tick() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    const s = await res.json();
    nameEl.textContent = s.name || '—';
    popEl.textContent = `${s.players}/${s.maxPlayers}`;
    wipeEl.textContent = wipeText(s.wipeTime);
    updatedEl.textContent = 'обновлено ' + new Date(s.updatedAt).toLocaleTimeString();

    geom = {
      W: Number(s.imageWidth) || 0,
      H: Number(s.imageHeight) || 0,
      margin: Number(s.oceanMargin) || 0,
      size: Number(s.mapSize) || 0,
    };
    if (geom.W && geom.H) mapEl.style.aspectRatio = `${geom.W} / ${geom.H}`;

    if (s.image && !imgEl.src.startsWith('data:')) {
      imgEl.src = s.image;
      emptyEl.style.display = 'none';
    } else if (!s.image) {
      emptyEl.style.display = 'flex';
    }

    overlayEl.innerHTML = '';
    lastState = s;
    renderTeam(s.team || [], s.mapSize);
    drawTrails(s.team || []);
    renderEvents(s.markers || [], s.mapSize);
    renderDeaths(s.deaths || []);
    renderNotes(s.notes || []);
    renderPeople(s.players || []);
    if (activeSteamId !== null && pcardEl && !pcardEl.hidden) {
      const keep = activeSteamId;
      activeSteamId = null; // чтобы showCard не свернул карточку
      showCard(keep);
    }
    const an = s.analytics || null;
    if (an) {
      renderStats(an.members || []);
      drawPop(an.popHistory || [], an.current, an.peak);
    } else {
      renderStats([]);
      drawPop([], 0, 0);
    }
  } catch (err) {
    updatedEl.textContent = 'нет связи';
  }
}

tick();
setInterval(tick, 10000);
