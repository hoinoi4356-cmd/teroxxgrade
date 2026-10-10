'use strict';

/**
 * Прослуховування парінга Rust+ із АВТОЗАПИСОМ у config.json.
 *
 * Використовує @liamcottle/push-receiver напряму (як CLI rustplus.js),
 * щоб надійно ловити нотифікації і розбирати payload pairing.
 *
 * Кроки:
 *   1. npm run pair-register   (один раз)
 *   2. npm run pair-listen     (цей скрипт)
 *   3. У грі: ESC → Rust+ → PAIR WITH SERVER
 */
const fs = require('fs');
const path = require('path');
const PushReceiverClient = require('@liamcottle/push-receiver/src/client');

const ROOT = path.resolve(__dirname, '..');
const CREDS = path.join(ROOT, 'data', 'rustplus-credentials.json');
const CONFIG_FILE = path.join(ROOT, 'config.json');

if (!fs.existsSync(CREDS)) {
  console.error('Нет данных регистрации. Сначала: npm run pair-register');
  process.exit(1);
}

let creds = {};
try {
  creds = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
} catch (e) {
  console.error('Не удаётся прочитать rustplus-credentials.json:', e.message);
  process.exit(1);
}

if (!creds.fcm_credentials || !creds.fcm_credentials.gcm) {
  console.error('fcm_credentials отсутствуют. Сначала: npm run pair-register');
  process.exit(1);
}

const { androidId, securityToken } = creds.fcm_credentials.gcm;
const client = new PushReceiverClient(androidId, securityToken, []);

console.log('');
console.log('===============================================');
console.log('  ОЖИДАЮ ПЕЙРИНГ RUST+ ...');
console.log('  В игре нажми:  ESC → Rust+ → PAIR WITH SERVER');
console.log('===============================================');
console.log('');

client.on('ON_DATA_RECEIVED', (data) => {
  const pairs = {};
  if (Array.isArray(data && data.appData)) {
    for (const e of data.appData) pairs[e.key] = e.value;
  }

  const bodyRaw = pairs['body'] || pairs['gcm.notification.body'] || '';
  let payload = null;
  if (typeof bodyRaw === 'string' && bodyRaw.trim().startsWith('{')) {
    try {
      payload = JSON.parse(bodyRaw);
    } catch (_) {
      /* ігнор */
    }
  }

  if (
    payload &&
    payload.ip &&
    payload.port &&
    payload.playerId &&
    typeof payload.playerToken !== 'undefined' &&
    payload.playerToken !== ''
  ) {
    savePairing(payload);
    restartBot();
    try {
      client.destroy();
    } catch (_) {
      /* ігнор */
    }
    process.exit(0);
  }

  console.log('(сообщение без пейринга, тип: ' + (pairs['title'] || '?') + ')');
});

client.on('error', (err) => console.error('push-receiver error:', err.message));

process.on('SIGINT', () => {
  try {
    client.destroy();
  } catch (_) {
    /* ігнор */
  }
  process.exit(0);
});

client
  .connect()
  .then(() => console.log('Подключено к FCM. Жду...'))
  .catch((err) => {
    console.error('Не удалось подключиться к FCM:', err.message);
    process.exit(1);
  });

function savePairing(pair) {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('config.json не найден — нечего записывать.');
    return;
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  cfg.rustplus = cfg.rustplus || {};
  cfg.rustplus.serverIp = String(pair.ip);
  cfg.rustplus.appPort = String(pair.port);
  cfg.rustplus.playerId = String(pair.playerId);
  cfg.rustplus.playerToken = String(pair.playerToken);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');

  console.log('');
  console.log('===============================================');
  console.log('  ✅ ПЕЙРИНГ ЗАПИСАН В config.json');
  console.log('===============================================');
  console.log('  Сервер  : ' + cfg.rustplus.serverIp + ':' + cfg.rustplus.appPort + (pair.name ? ' (' + pair.name + ')' : ''));
  console.log('  playerId: ' + cfg.rustplus.playerId);
  console.log('  playerToken: збережено ✔');
  console.log('');
  console.log('  Теперь запусти бота:  start-bot.bat  (или npm.cmd start)');
}

// Перезапуск бота після парінга — щоб усе «підхопилося» одразу
function restartBot() {
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'restart-bot.js')], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  console.log('Бота перезапускаю автоматически...');
}