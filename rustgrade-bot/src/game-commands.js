'use strict';

const { markerLabel, gridLabel } = require('./markers');
const { describeTime, mskTime } = require('./time-utils');

/**
 * In-game team chat commands. A player types "!pop" etc. and the bot answers
 * in team chat. Replies are kept within Rust's 128-char team chat limit.
 */
class GameCommands {
  constructor({ manager, config, webMap, analytics, steam, players }) {
    this.manager = manager;
    this.config = config;
    this.webMap = webMap;
    this.analytics = analytics || null;
    this.steam = steam || null;
    this.players = players || null;
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
        return this._reply('Команды: !pop !time !online !events !map !wipe !devices !switch !stats !player !track !leader !players');
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
      case 'devices':
        return this._cmdDevices();
      case 'switch':
        return this._cmdSwitch(args);
      case 'stats':
        return this._cmdStats(args);
      case 'player':
      case 'steam':
        return this._cmdPlayer(args);
      case 'track':
        return this._cmdTrack(args);
      case 'leader':
      case 'top':
        return this._cmdLeader(args, name);
      case 'players':
        return this._cmdPlayers();
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

  async _cmdPlayer(args) {
    const query = (args[0] || '').trim();
    if (!query) return this._reply('Формат: !player <ник>');
    if (!this.steam) return this._reply('Steam недоступен.');
    let steamId = null;
    if (/^\d{17}$/.test(query)) {
      steamId = query;
    } else if (this.analytics) {
      const members = this.analytics.leaderboard();
      const q = query.toLowerCase();
      const found =
        members.find((m) => (m.name || '').toLowerCase() === q) ||
        members.find((m) => (m.name || '').toLowerCase().includes(q));
      if (found) steamId = found.steamId;
    }
    if (!steamId && this.players) {
      const hit = this.players.find(query)[0];
      if (hit) steamId = hit.steamId;
    }
    if (!steamId) return this._reply(`Игрок "${query}" не найден. Нужен Steam ID.`);
    const p = await this.steam.get(steamId);
    if (!p) return this._reply('Профиль Steam недоступен.');
    const hours = p.rustHours != null ? `${p.rustHours}ч Rust` : 'часы Rust скрыты';
    const vac = p.vacBanned ? ' | VAC-бан' : '';
    let srv = '';
    if (this.analytics) {
      const an = this.analytics.leaderboard().find((x) => x.steamId === steamId);
      if (an) {
        srv = ` | ${an.online ? 'в игре' : 'офлайн'} ${this._fmtDur(an.onlineSeconds)} ☠${an.deaths}`;
        const mapSize = this.manager.mapSize || 0;
        if (an.lastPos && mapSize) srv += ` ${gridLabel(an.lastPos.x, an.lastPos.y, mapSize)}`;
      }
    }
    this._reply(`${p.name || query}: ${hours}${vac}${srv}`);
  }

  async _cmdDevices() {
    const devices = this.config.settings.devices || [];
    if (!devices.length) return this._reply('Smart-устройства не настроены.');
    const names = devices.map((d) => (typeof d === 'object' ? d.name || d.id : d)).join(', ');
    this._reply(`Устройства: ${names}`);
  }

  async _cmdSwitch(args) {
    const [actionRaw, nameRaw] = args;
    const action = (actionRaw || '').toLowerCase();
    if (!['on', 'off'].includes(action) || !nameRaw) {
      return this._reply('Формат: !switch on|off <название>');
    }
    const devices = this.config.settings.devices || [];
    const target = devices.find((d) => {
      const n = typeof d === 'object' ? d.name || String(d.id) : String(d);
      return n.toLowerCase() === nameRaw.toLowerCase();
    });
    if (!target) return this._reply(`Устройство "${nameRaw}" не найдено.`);
    const id = typeof target === 'object' ? target.id : target;
    const ok = await this.manager.turnSmartSwitch(Number(id), action === 'on');
    this._reply(ok ? `${nameRaw}: ${action.toUpperCase()}` : `Не удалось переключить ${nameRaw}`);
  }
}

module.exports = GameCommands;
