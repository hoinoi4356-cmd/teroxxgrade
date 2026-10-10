'use strict';

// Швидкий смоук-тест живої мапи без реального Rust+ сервера.
const http = require('http');
const EventEmitter = require('events');
const WebMap = require('../src/web-map');

const manager = new EventEmitter();
manager.playerId = '76561190000000000';
manager._infoCache = {
  name: 'Test Server',
  mapSize: 3000,
  players: 10,
  maxPlayers: 100,
  wipeTime: Math.floor(Date.now() / 1000) - 86400,
};
manager._mapCache = null;
manager.getInfoAsync = async () => manager._infoCache;
manager.getMapAsync = async () => null;
manager.lastTeamInfo = {
  leaderSteamId: '76561190000000001',
  members: [{ name: 'Bob', x: 1500, y: 1500, isOnline: true, isAlive: true, steamId: '76561190000000001' }],
};
manager.currentEventMarkers = () => [{ type: 5, x: 500, y: 800 }];

const config = { settings: { webMap: { enabled: true, port: 8799 } } };
const wm = new WebMap({ manager, config });
wm.start();

function get(p) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://localhost:8799${p}`, (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => resolve({ status: r.statusCode, body: d }));
      })
      .on('error', reject);
  });
}

setTimeout(async () => {
  try {
    const html = await get('/');
    const js = await get('/app.js');
    const state = await get('/api/state');
    const parsed = JSON.parse(state.body);
    console.log('index.html:', html.status, html.body.includes('RUSTMAP') ? 'ok' : 'missing-brand');
    console.log('app.js    :', js.status);
    console.log('state     :', parsed.name, '| team:', parsed.team.length, '| markers:', parsed.markers.length, '| grid:', parsed.markers[0] && parsed.markers[0].grid);
    const ok = html.status === 200 && js.status === 200 && state.status === 200 && parsed.team.length === 1 && parsed.markers.length === 1;
    console.log(ok ? 'WEBMAP-OK ✔' : 'WEBMAP-FAIL ✘');
    wm.stop();
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error('WEBMAP-ERROR', err.message);
    process.exit(1);
  }
}, 500);
