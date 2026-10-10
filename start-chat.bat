@echo off
REM Стартує локальний сервер і відкриває оверлей чату Twitch.
REM У OBS: джерело "Браузер", URL  http://localhost:3000/chat.html

setlocal
set "RG_DIR=%~dp0"

start "rustgrade server" powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "& '%RG_DIR%serve.ps1'"

timeout /t 1 /nobreak >nul
start "" "http://localhost:3000/chat.html"

endlocal
