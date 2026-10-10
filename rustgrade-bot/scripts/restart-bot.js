'use strict';

// Перезапускає бота: глушить старі інстанси src/index.js і запускає новий (приховано).
const { spawnSync, spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// 1) зупинити всі node-процеси, що запускають src/index.js
const killCmd = [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'index\\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
];
spawnSync('powershell.exe', killCmd, { stdio: 'inherit', windowsHide: true });

// 2) запустити бота приховано
const wscript = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'wscript.exe');
const child = spawn(wscript, [path.join(ROOT, 'run-hidden.vbs')], {
  cwd: ROOT,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
});
child.unref();

console.log('RustBot перезапущен (скрыто).');