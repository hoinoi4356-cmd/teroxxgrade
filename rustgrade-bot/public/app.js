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

function wipeText(ts) {
  if (!ts) return 'вайп —';
  const days = Math.floor((Date.now() / 1000 - ts) / 86400);
  return `вайп ${days}д`;
}

function dot(cls, leftPct, topPct, label) {
  const d = document.createElement('div');
  d.className = 'dot ' + cls;
  d.style.left = leftPct + '%';
  d.style.top = topPct + '%';
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

function renderTeam(team, size) {
  teamEl.innerHTML = '';
  if (!team.length) {
    teamEl.innerHTML = '<li class="off">Нет данных о команде</li>';
    return;
  }
  team.forEach((m) => {
    const p = worldToPct(Number(m.x), Number(m.y));
    const cls = !m.isOnline ? 'team-offline' : (m.isAlive ? 'team-online' : 'team-dead');
    dot(cls, p.left, p.top, m.name);
    const li = document.createElement('li');
    li.className = m.isOnline ? '' : 'off';
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
    renderTeam(s.team || [], s.mapSize);
    renderEvents(s.markers || [], s.mapSize);
    renderDeaths(s.deaths || []);
    renderNotes(s.notes || []);
    renderPeople(s.players || []);
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
