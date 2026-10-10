'use strict';

const { markerLabel, gridLabel } = require('./markers');
const { describeTime } = require('./time-utils');

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
        return this._reply('Команды: !pop !time !online !events !map !wipe !devices !switch !stats !player !players');
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

  async _cmdPop() {
    const info = await this.manager.getInfoAsync();
    if (!info) return this._reply('Онлайн недоступен, попробуй позже.');
    const queue = info.queuedPlayers ? ` (очередь ${info.queuedPlayers})` : '';
    this._reply(`Онлайн: ${info.players}/${info.maxPlayers}${queue} | ${info.name || 'Rust'}`);
  }

  async _cmdTime() {
    const t = await this.manager.getTimeAsync();
    if (!t) return this._reply('Время недоступно.');
    const d = describeTime(t);
    this._reply(`Сейчас ${d.clock} (${d.phase}). Осталось ${d.untilLabel}: ${d.untilText}`);
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
      return this._reply(
        `${m.name}${m.online ? ' (в игре)' : ''}: наиграно ${this._fmtDur(m.onlineSeconds)}, сессий ${m.sessions}, смертей ${m.deaths}`
      );
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
    const vac = p.vacBanned ? ' | ⚠ VAC-бан' : '';
    this._reply(`${p.name || query}: ${hours}${vac}`);
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
