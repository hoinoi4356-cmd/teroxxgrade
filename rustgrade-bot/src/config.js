'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const EXAMPLE_PATH = path.join(ROOT, 'config.example.json');

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { ok: false, reason: `config.json не найден: ${CONFIG_PATH}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(stripBom(fs.readFileSync(CONFIG_PATH, 'utf8')));
  } catch (err) {
    return { ok: false, reason: `config.json не является корректным JSON: ${err.message}` };
  }

  // sensible defaults so a partially filled config still boots
  parsed.discord = parsed.discord || {};
  parsed.discord.channels = parsed.discord.channels || {};
  parsed.rustplus = parsed.rustplus || {};
  parsed.settings = parsed.settings || {};
  parsed.settings.prefix = parsed.settings.prefix || '!';
  parsed.settings.botName = parsed.settings.botName || 'RustBot';
  parsed.settings.relayDiscordToGame = parsed.settings.relayDiscordToGame !== false;
  parsed.settings.relayGameToDiscord = parsed.settings.relayGameToDiscord !== false;
  parsed.settings.relayClanChat = parsed.settings.relayClanChat !== false;
  parsed.settings.discordToGameFormat = parsed.settings.discordToGameFormat || '[Discord] {author}: {message}';
  parsed.settings.pollMapMarkersSeconds = Number(parsed.settings.pollMapMarkersSeconds) || 20;
  parsed.settings.webMap = parsed.settings.webMap || {};
  parsed.settings.webMap.port = Number(parsed.settings.webMap.port) || 8787;
  parsed.settings.eventMarkerTypes = (parsed.settings.eventMarkerTypes || [4, 5, 6, 8]).map(Number);
  parsed.settings.devices = Array.isArray(parsed.settings.devices) ? parsed.settings.devices : [];
  parsed.accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];

  return { ok: true, config: parsed };
}

/**
 * Повертає список Rust+ акаунтів, які має підключити бот.
 * Основний акаунт (config.rustplus) завжди додається першим, далі — усі з config.accounts.
 * Це дозволяє кільком людям (напр. лідеру іншого клану) спарити свій акаунт,
 * щоб сповіщення в грі йшли ВІД ЇХНЬОГО ніку.
 */
function getAccounts(config) {
  const list = [];
  const seen = new Set();
  const push = (acc) => {
    if (!acc) return;
    const name = acc.name || acc.label || 'Rust';
    const serverIp = acc.serverIp;
    const appPort = acc.appPort;
    const playerId = acc.playerId;
    const playerToken = acc.playerToken;
    if (!serverIp || !appPort || !playerId || !playerToken) return;
    const key = `${serverIp}:${appPort}:${playerId}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ name, serverIp: String(serverIp), appPort: String(appPort), playerId: String(playerId), playerToken: String(playerToken) });
  };

  const r = config.rustplus || {};
  push({ name: (config.settings && config.settings.botName) || 'RustBot', ...r });
  for (const a of config.accounts || []) push(a);

  return list;
}

function validateConfig(config) {
  const problems = [];
  const d = config.discord || {};
  const r = config.rustplus || {};
  if (!d.token || /PASTE/i.test(d.token)) problems.push('discord.token — вставь токен бота');
  const hasAccounts = Array.isArray(config.accounts) && config.accounts.length > 0;
  if (!hasAccounts) {
    if (!r.serverIp) problems.push('rustplus.serverIp — IP/хост сервера Rust');
    if (!r.appPort) problems.push('rustplus.appPort — app.port (Rust+ порт сервера)');
    if (!r.playerId) problems.push('rustplus.playerId — твой Steam64 ID');
    if (!r.playerToken) problems.push('rustplus.playerToken — токен из пейринга Rust+');
  }
  return problems;
}

module.exports = { loadConfig, validateConfig, getAccounts, CONFIG_PATH, EXAMPLE_PATH, ROOT };
