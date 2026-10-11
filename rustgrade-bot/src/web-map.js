'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const log = require('./logger');
const { markerLabelRu, markerTypeNumber, gridLabel } = require('./markers');

// Unicode-иконки для веб-карты (в Discord свои эмодзи-коды).
const MARKER_EMOJI_UNICODE = {
  2: '💥',
  3: '🛒',
  4: '🚁',
  5: '🚢',
  6: '🪂',
  7: '🚨',
  8: '🚁',
};

/**
 * Small built-in web server that renders a live map with team positions,
 * event markers and server info. No extra dependencies.
 */
class WebMap {
  constructor({ manager, config, analytics, steam, players }) {
    this.manager = manager;
    this.config = config;
    this.analytics = analytics || null;
    this.steam = steam || null;
    this.players = players || null;
    this.settings = (config.settings && config.settings.webMap) || {};
    this.port = Number(this.settings.port) || 8787;
    this.enabled = this.settings.enabled !== false;
    this.server = null;
    this.publicDir = path.resolve(__dirname, '..', 'public');
  }

  localUrl() {
    if (this.settings.publicUrl) return this.settings.publicUrl;
    return this.enabled ? `http://localhost:${this.port}` : '';
  }

  start() {
    if (!this.enabled) {
      log.info('Live map: отключена в настройках');
      return;
    }
    this.server = http.createServer((req, res) => this._handle(req, res));
    this.server.on('error', (err) => log.error('Live map server error:', err.message));
    this.server.listen(this.port, () => log.info(`Live map: http://localhost:${this.port}`));
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  async _handle(req, res) {
    try {
      const url = (req.url || '/').split('?')[0];
      if (url === '/api/state') return await this._serveState(res);
      if (url === '/' || url === '/index.html') return this._serveFile(res, 'index.html', 'text/html; charset=utf-8');
      if (url === '/app.js') return this._serveFile(res, 'app.js', 'application/javascript; charset=utf-8');
      if (url === '/app.css') return this._serveFile(res, 'app.css', 'text/css; charset=utf-8');
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } catch (err) {
      log.error('Live map request failed:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('error');
    }
  }

  _serveFile(res, name, type) {
    const file = path.join(this.publicDir, name);
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    });
  }

  async _serveState(res) {
    const info = (await this.manager.getInfoAsync()) || this.manager._infoCache || null;
    const map = this.manager._mapCache || (await this.manager.getMapAsync());
    const team = (this.manager.lastTeamInfo && this.manager.lastTeamInfo.members) || [];
    const markers = this.manager.currentEventMarkers();

    let image = null;
    if (map && map.jpgImage) {
      try {
        image = 'data:image/jpeg;base64,' + Buffer.from(map.jpgImage).toString('base64');
      } catch (_) {
        image = null;
      }
    }

    const an = this.analytics ? this.analytics.summary() : null;

    const state = {
      name: (info && info.name) || '',
      mapSize: (info && info.mapSize) || 0,
      players: (info && info.players) || 0,
      maxPlayers: (info && info.maxPlayers) || 0,
      wipeTime: (info && info.wipeTime) || 0,
      image,
      imageWidth: (map && map.width) || 0,
      imageHeight: (map && map.height) || 0,
      oceanMargin: (map && map.oceanMargin) || 0,
      team: team.map((m) => {
        const sp = this.steam ? this.steam.peek(m.steamId) : null;
        return {
          name: m.name || '?',
          steamId: String(m.steamId),
          avatar: (sp && sp.avatar) || '',
          rustHours: sp && sp.rustHours != null ? sp.rustHours : null,
          x: m.x,
          y: m.y,
          isOnline: !!m.isOnline,
          isAlive: !!m.isAlive,
          isLeader: String(m.steamId) === String((this.manager.lastTeamInfo || {}).leaderSteamId || ''),
          path: this.analytics ? this.analytics.pathOf(m.steamId, 60) : [],
        };
      }),
      markers: markers.map((m) => {
        const type = markerTypeNumber(m.type);
        return {
          type,
          label: markerLabelRu(type),
          emoji: MARKER_EMOJI_UNICODE[type] || '',
          grid: gridLabel(m.x, m.y, (info && info.mapSize) || 0),
          x: m.x,
          y: m.y,
        };
      }),
      deaths: (typeof this.manager.recentDeaths === 'function' ? this.manager.recentDeaths() : []).map((d) => ({
        name: d.name,
        x: d.x,
        y: d.y,
        grid: gridLabel(d.x, d.y, (info && info.mapSize) || 0),
        at: d.at,
      })),
      notes: (typeof this.manager.teamNotes === 'function' ? this.manager.teamNotes() : []).map((n) => ({
        x: n.x,
        y: n.y,
        by: n.by,
        grid: gridLabel(n.x, n.y, (info && info.mapSize) || 0),
      })),
      analytics: an
        ? {
            current: an.current,
            peak: an.peak,
            popHistory: an.popHistory,
            members: an.members.map((m) => {
              const sp = this.steam ? this.steam.peek(m.steamId) : null;
              return {
                name: m.name,
                steamId: m.steamId,
                onlineSeconds: m.onlineSeconds,
                sessions: m.sessions,
                deaths: m.deaths,
                online: m.online,
                lastSeen: m.lastSeen,
                steamHours: sp ? sp.rustHours : null,
                avatar: (sp && sp.avatar) || '',
                lastPos: m.lastPos || null,
                lastDeath: m.lastDeath || null,
                path: this.analytics ? this.analytics.pathOf(m.steamId, 60) : [],
              };
            }),
          }
        : null,
      players: this.players
        ? this.players.list().slice(0, 40).map((e) => ({
            name: e.name,
            online: !!e.online,
            lastSeen: e.lastSeen,
            chats: e.chats || 0,
            deaths: e.deaths || 0,
          }))
        : [],
      onlineCount: this.players ? this.players.onlineList().length : 0,
      updatedAt: Date.now(),
    };

    const body = JSON.stringify(state);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  }
}

module.exports = WebMap;
