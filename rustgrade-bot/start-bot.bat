@echo off
chcp 65001 >nul
cd /d "%~dp0"
title RUSTBOT

if not exist config.json (
  echo [!] Создаю config.json из образца...
  copy /Y config.example.json config.json >nul
)

rem --- заполнен ли discord.token? если нет — открываем config.json ---
node -e "let t='';try{t=(JSON.parse(require('fs').readFileSync('config.json','utf8')).discord||{}).token||''}catch(e){}process.exit(t?0:9)"
if errorlevel 9 (
  echo.
  echo [!] discord.token пустой.
  echo     Сейчас открою config.json - вставь туда токен бота 303_bot и сохрани.
  echo.
  notepad config.json
)

if not exist node_modules (
  echo [*] Устанавливаю зависимости ^(первый запуск^)...
  call npm.cmd install
)

echo [*] Патч rustplus.js ^(queuedPlayers^)...
node scripts\patch-rustplus.js

echo [*] Запускаю RUSTBOT...  ^(чтобы остановить - просто закрой это окно^)
echo.

:loop
node src/index.js
echo.
echo [x] Бот остановился ^(код %errorlevel%^). Автоперезапуск через 5 секунд...
timeout /t 5 /nobreak >nul
goto loop