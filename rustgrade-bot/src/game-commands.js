'use strict';

const { markerLabel, gridLabel, GRID_DIAMETER } = require('./markers');
const { describeTime, mskTime } = require('./time-utils');

// «A»->0, «Z»->25, «AA»->26 … — зворотний бік gridLabel()
function lettersToIndex(s) {
  let v = 0;
  for (const ch of String(s || '').toUpperCase()) v = v * 26 + (ch.charCodeAt(0) - 64);
  return v - 1;
}

/**
 * In-game team chat commands. A player types "!pop" etc. and the bot answers
 * in team chat. Replies are kept within Rust's 128-char team chat limit.
 */
class GameCommands {
  constructor({ manager, config, webMap, analytics, steam, players, discord }) {
    this.manager = manager;
    this.config = config;
    this.webMap = webMap;
    this.analytics = analytics || null;
    this.steam = steam || null;
    this.players = players || null;
    this.discord = discord || null;
    this.prefix = (config.settings && config.settings.prefix) || '!';
  }

  handle({ steamId, name, text }) {
    if (!text || !text.startsWith(this.prefix)) return;
    // власні «відлуння» повідомлень бота вже відфільтровані в manager (_isOwnEcho),
    // тому тут НЕ ігноруємо за steamId — інакше не працювали б команди самого гравця

    const body = text.slice(this.prefix.length).trim();
    if (!body) return;
    const [rawCmd, ...args] = body.split(/\s+/);
    const cmd = rawCmd.toLowerCase();

    switch (cmd) {
      case 'help':
        return this._reply('Команды: !pop !time !online !events !map !wipe !stats !track !leader !players !near !offline !warn !grid !raid !afk');
      case 'pop':
        return this._cmdPop();
      case 'time':
        return this._cmdTime();
      case 'online':
      case 'team':
        return this._cmdOnline();
      case 'events':
        return this._cmdEvents();
      case 'map':
        return this._cmdMap();
      case 'wipe':
        return this._cmdWipe();
      case 'stats':
        return this._cmdStats(args);
      case 'track':
        return this._cmdTrack(args);
      case 'leader':
      case 'top':
        return this._cmdLeader(args, name);
      case 'players':
        return this._cmdPlayers();
      case 'near':
        return this._cmdNear(args, steamId);
      case 'offline':
        return this._cmdOffline();
      case 'warn':
        return this._cmdWarn(args);
      case 'grid':
        return this._cmdGrid(args);
      case 'raid':
        return this._cmdRaid(args, steamId, name);
      case 'afk':
      case 'афк':
        return this._cmdAfk(args, name);
      default:
        return undefined;
    }
  }

  _reply(text) {
    this.manager.sendTeamMessage(text);
  }

  _fmtHour(value) {
    const h = Math.floor(value);
    const m = Math.floor((value - h) * 60)
      .toString()
      .padStart(2, '0');
    return `${h.toString().padStart(2, '0')}:${m}`;
  }

  _hm(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }

  _ago(ts) {
    if (!ts) return '';
    const d = Math.round((Date.now() - ts) / 1000);
    if (d < 60) return 'только что';
    if (d < 3600) return `${Math.floor(d / 60)}м назад`;
    if (d < 86400) return `${Math.floor(d / 3600)}ч назад`;
    return `${Math.floor(d / 86400)}д назад`;
  }

  async _cmdPop() {
    const info = await this.manager.getInfoAsync();
    if (!info) return this._reply('Онлайн недоступен, попробуй позже.');
    const queue = info.queuedPlayers ? ` (очередь ${info.queuedPlayers})` : '';
    this._reply(`Онлайн: ${info.players}/${info.maxPlayers}${queue} | ${info.name || 'Rust'}`);
  }

  async _cmdTime() {
    const msk = mskTime();
    const t = await this.manager.getTimeAsync();
    if (!t) return this._reply(`МСК ${msk.clockSec} (${msk.date})`);
    const d = describeTime(t);
    this._reply(`МСК ${msk.clockSec} (${msk.date}) | до ${d.untilLabel.replace('до ', '')}: ${d.untilText}`);
  }

  async _cmdOnline() {
    const team = await this.manager.getTeamInfoAsync();
    if (!team) return this._reply('Команда недоступна.');
    const members = team.members || [];
    const online = members.filter((m) => m.isOnline).length;
    const names = members
      .map((m) => `${m.isOnline ? '+' : '-'}${(m.name || '?')}${m.isAlive ? '' : '*'}`)
      .join(' ');
    this._reply(`Команда ${online}/${members.length}: ${names}`);
  }

  _cmdEvents() {
    const markers = this.manager.currentEventMarkers();
    if (!markers.length) return this._reply('Активных событий нет (или сервер не отдаёт маркеры).');
    const parts = markers.map((m) => `${markerLabel(m.type)} ${gridLabel(m.x, m.y, this.manager.mapSize)}`);
    this._reply(`События: ${parts.join(', ')}`);
  }

  _cmdMap() {
    const url =
      (this.config.settings.webMap && this.config.settings.webMap.publicUrl) ||
      (this.webMap && this.webMap.localUrl()) ||
      '';
    this._reply(url ? `Живая карта: ${url}` : 'Карта отключена в настройках.');
  }

  async _cmdWipe() {
    const info = await this.manager.getInfoAsync();
    if (!info || !info.wipeTime) return this._reply('Информация о вайпе недоступна.');
    const days = Math.floor((Date.now() / 1000 - info.wipeTime) / 86400);
    this._reply(`Вайп был ${days} дн. назад | ${info.name || 'Rust'}`);
  }

  _fmtDur(s) {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h) return `${h}ч ${m}м`;
    if (m) return `${m}м`;
    return `${s}с`;
  }

  _cmdStats(args) {
    if (!this.analytics) return this._reply('Статистика недоступна.');
    const members = this.analytics.leaderboard();
    if (!members.length) return this._reply('Статистики пока нет.');
    const query = (args[0] || '').trim().toLowerCase();
    if (query) {
      const m =
        members.find((x) => x.steamId === query) ||
        members.find((x) => (x.name || '').toLowerCase().includes(query));
      if (!m) return this._reply(`Игрок "${args[0]}" не найден.`);
      let s = `${m.name}${m.online ? ' (в игре)' : ''}: наиграно ${this._fmtDur(m.onlineSeconds)}, сессий ${m.sessions}, смертей ${m.deaths}`;
      if (m.online && m.lastConnected) s += `, зашёл ${this._hm(m.lastConnected)}`;
      else if (!m.online && m.lastDisconnected) s += `, вышел ${this._ago(m.lastDisconnected)}`;
      return this._reply(s);
    }
    const top = members.slice(0, 3).map((m) => `${m.name} ${this._fmtDur(m.onlineSeconds)}`).join(', ');
    this._reply(`Топ по онлайну: ${top}`);
  }

  _cmdPlayers() {
    if (!this.players) return this._reply('Реестр игроков недоступен.');
    const all = this.players.list();
    if (!all.length) return this._reply('Пока никого не видел.');
    const online = all.filter((e) => e.online).map((e) => e.name);
    this._reply(`В сети: ${online.length ? online.join(', ') : 'никого'} | в базе: ${all.length}`);
  }

  // Кто из команды рядом (по последним данным о составе — обновляются каждые ~5 с).
  _cmdNear(args, steamId) {
    const radius = Math.min(500, Math.max(10, parseInt(args[0], 10) || 100));
    const states =
      (this.manager && typeof this.manager.teamMemberStates === 'function'
        ? this.manager.teamMemberStates()
        : []) || [];
    const me = states.find((s) => String(s.steamId) === String(steamId));
    if (!me || me.x == null || me.y == null) {
      return this._reply('Твоя позиция недоступна (нет данных о команде).');
    }
    const dist = (o) => Math.round(Math.hypot(Number(o.x) - Number(me.x), Number(o.y) - Number(me.y)));
    const near = states
      .filter((o) => o.isOnline && String(o.steamId) !== String(steamId) && o.x != null && o.y != null && dist(o) <= radius)
      .sort((a, b) => dist(a) - dist(b));
    if (!near.length) return this._reply(`Рядом (до ${radius}м) никого из команды.`);
    const lines = near.map((o) => `${o.name} ${dist(o)}м`);
    const head = `Рядом (до ${radius}м):`;
    const parts = this._chunks(lines);
    this._reply(`${head} ${parts.shift() || ''}`.trim());
    for (const c of parts) this._reply(c);
  }

  // Кто из команды офлайн и как давно вышел.
  _cmdOffline() {
    if (!this.players) return this._reply('Реестр игроков недоступен.');
    const off = this.players.list().filter((e) => e.team && !e.online);
    if (!off.length) return this._reply('Все из команды в сети.');
    const lines = off.map((e) => `${e.name} (вышел ${this._ago(e.lastOut || e.lastSeen)})`);
    const parts = this._chunks(lines);
    this._reply(`Офлайн: ${parts.shift() || ''}`.trim());
    for (const c of parts) this._reply(c);
  }

  // Таймер-напоминание: !warn <минут> <текст>.
  _cmdWarn(args) {
    const mins = parseInt(args[0], 10);
    const text = args.slice(1).join(' ').trim();
    if (!Number.isFinite(mins) || mins < 1 || mins > 1440 || !text) {
      return this._reply('Формат: !warn <минут> <текст> (1–1440)');
    }
    const finalMsg = `[Напоминание] ${text}`;
    setTimeout(() => this.manager.sendTeamMessage(finalMsg), mins * 60000);
    this._reply(`Напишу «${finalMsg}» через ${mins} мин.`);
  }

  // Координаты <-> квадрат карты: !grid X Y или !grid A1.
  _cmdGrid(args) {
    const mapSize = this.manager.mapSize || 0;
    if (!mapSize) return this._reply('Размер карты неизвестен.');
    const [a, b] = args;
    if (a && b && Number.isFinite(Number(a)) && Number.isFinite(Number(b))) {
      return this._reply(`Квадрат: ${gridLabel(Number(a), Number(b), mapSize)}`);
    }
    const m = /^([A-Za-z]+)(\d+)$/.exec(String(a || ''));
    if (m) {
      const colIdx = lettersToIndex(m[1]);
      const row = parseInt(m[2], 10);
      const cx = (colIdx + 0.5) * GRID_DIAMETER;
      const cy = mapSize - (row + 0.5) * GRID_DIAMETER;
      if (cx < 0 || cx > mapSize || cy < 0 || cy > mapSize) {
        return this._reply(`Квадрат "${m[0].toUpperCase()}" вне карты.`);
      }
      return this._reply(
        `${m[0].toUpperCase()} — центр: ${Math.round(cx)} ${Math.round(cy)} ${gridLabel(cx, cy, mapSize)}`
      );
    }
    return this._reply('Формат: !grid X Y (координаты) или !grid A1 (квадрат)');
  }

  // Тревога «нас рейдят»: пишем в чат команды + в Discord (приватный канал) с @everyone.
  _cmdRaid(args, steamId, who) {
    const gridArg = (args[0] || '').trim().toUpperCase();
    let grid = gridArg;
    if (!grid && this.manager.teamMemberStates) {
      const me = this.manager
        .teamMemberStates()
        .find((s) => String(s.steamId) === String(steamId));
      if (me && me.x != null && me.y != null) {
        grid = gridLabel(Math.round(Number(me.x)), Math.round(Number(me.y)), this.manager.mapSize);
      }
    }
    const at = grid ? ` Квадрат ${grid}` : '';
    this._reply(`[ТРЕВОГА] НАС РЕЙДЯТ!${at} — вызов: ${who || '?'}`.slice(0, 128));
    if (!this.discord) return;
    const ch =
      (this.config.discord.channels && this.config.discord.channels.raid) ||
      (this.config.discord.channels && this.config.discord.channels.teamChat) ||
      (this.config.discord.channels && this.config.discord.channels.alerts) ||
      '';
    if (!ch) return;
    this.discord.sendToChannel(
      String(ch),
      `@everyone 🚨🚨🚨 **НАС РЕЙДЯТ!** 🚨🚨🚨${at}\nТревогу поднял **${who || '?'}**`
    );
  }

  // АФК: пишем в чат команды + в Discord-канал АФК своего сервера.
  // Канал: свой на акаунт (channelsPerAccount.<имя>.afk) -> общий (channels.afk).
  _cmdAfk(args, name) {
    const text = args.join(' ').trim();
    const who = name || '?';
    this._reply(`[АФК] ${who}${text ? ' — ' + text : ''}`.slice(0, 128));
    if (!this.discord) return;
    const per = (this.config.discord.channelsPerAccount || {})[this.manager.accountName] || {};
    const ch =
      per.afk ||
      (this.config.discord.channels && this.config.discord.channels.afk) ||
      '';
    if (!ch) return;
    this.discord.sendToChannel(
      String(ch),
      `⏸ **${who}** — АФК${text ? ': ' + text : ''} • ${this.manager.accountName}`
    );
  }

  // Разбивает строки на сообщения по лимиту чата Rust (128 символов).
  _chunks(lines, max = 120) {
    const out = [];
    let cur = '';
    for (const l of lines) {
      const cand = cur ? `${cur}; ${l}` : l;
      if (cand.length > max) {
        if (cur) out.push(cur);
        cur = l;
      } else {
        cur = cand;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  // Лідерка пачки — відповідь у командний чат гри,
  // звернена до того, хто написав команду.
  _cmdLeader(args, who) {
    if (!this.analytics) return this._reply('Статистика недоступна.');
    const members = this.analytics.leaderboard();
    if (!members.length) return this._reply('Статистики пока нет.');
    let n = parseInt(args[0], 10);
    if (!Number.isFinite(n) || n < 1) n = 5;
    n = Math.min(10, n);
    const lines = members
      .slice(0, n)
      .map((m, i) => `${i + 1}.${m.name} ${this._fmtDur(m.onlineSeconds)}${m.online ? '*' : ''}`);
    const chunks = this._chunks(lines);
    const head = `${who ? who + ', ' : ''}лидерка (наиграно):`;
    this._reply(`${head} ${chunks.shift() || ''}`.trim());
    for (const c of chunks) this._reply(c);
  }

  _cmdTrack(args) {
    const query = (args[0] || '').trim();
    if (!query) return this._reply('Формат: !track <ник>');
    if (!this.analytics) return this._reply('Нет данных для отслеживания.');
    const members = this.analytics.leaderboard();
    const q = query.toLowerCase();
    const m =
      members.find((x) => x.steamId === query) ||
      members.find((x) => (x.name || '').toLowerCase() === q) ||
      members.find((x) => (x.name || '').toLowerCase().includes(q));
    if (!m) return this._reply(`"${query}" не в команде — позицию видно только у тиммейтов.`);
    const mapSize = this.manager.mapSize || 0;
    const g = (p) => (p && mapSize ? gridLabel(p.x, p.y, mapSize) : '?');
    let s = `${m.name}: ${m.online ? 'в игре' : 'офлайн'} | ${this._fmtDur(m.onlineSeconds)} | ☠${m.deaths}`;
    if (m.online && m.lastConnected) s += ` | зашёл ${this._hm(m.lastConnected)}`;
    else if (!m.online && m.lastDisconnected) s += ` | вышел ${this._ago(m.lastDisconnected)}`;
    if (m.lastPos) s += ` | ${m.online ? 'квадрат' : 'был в'} ${g(m.lastPos)}`;
    if (m.lastDeath) s += ` | умер: ${g(m.lastDeath)}`;
    this._reply(s);
  }

  }

module.exports = GameCommands;
