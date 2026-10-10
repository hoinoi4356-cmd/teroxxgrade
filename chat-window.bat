@echo off
REM Відкриває чат Twitch каналу у власному вікні і закріплює його
REM поверх усіх вікон (always on top). Чат завжди видно під час стріму.
REM
REM Якщо вікно не закріпилось — воно просто відкриється звичайним
REM вкладеним вікном браузера; закріплення можна увімкнути в браузері.

setlocal
set "RG_DIR=%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%RG_DIR%pin-chat.ps1"

pause
endlocal
