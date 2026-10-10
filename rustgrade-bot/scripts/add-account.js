'use strict';
// Додає Rust+ акаунт у config.json (accounts), щоб сповіщення в грі йшли від ЙОГО ніку.
//
// Використання:
//   node scripts/add-account.js "Нік" <serverIp> <appPort> <playerId> <playerToken>
//
// Токен Rust+ людина отримує, спаривши сервер (ESC -> Rust+ -> PAIR WITH SERVER)
// у своєму акаунті. Сервер/IP/порт/playerId також приходять у тому ж парінгу.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'config.json');

const [name, serverIp, appPort, playerId, playerToken] = process.argv.slice(2);

if (!name || !serverIp || !appPort || !playerId || !playerToken) {
  console.log('Формат: node scripts/add-account.js "Ник" <serverIp> <appPort> <playerId> <playerToken>');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
config.accounts = Array.isArray(config.accounts) ? config.accounts : [];

const key = (a) => `${a.serverIp}:${a.appPort}:${a.playerId}`;
const entry = {
  name: String(name),
  serverIp: String(serverIp),
  appPort: String(appPort),
  playerId: String(playerId),
  playerToken: String(playerToken),
};

const idx = config.accounts.findIndex((a) => key(a) === key(entry));
if (idx >= 0) {
  config.accounts[idx] = { ...config.accounts[idx], ...entry };
  console.log(`Обновлён аккаунт: ${name}`);
} else {
  config.accounts.push(entry);
  console.log(`Добавлен аккаунт: ${name}`);
}

fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2), 'utf8');
console.log('Готово. Перезапусти бота, чтобы применить изменения.');
