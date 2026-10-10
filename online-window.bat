@echo off
REM Відкриває лічильник глядачів стріму у маленькому вікні поверх усіх
REM вікон. Потрібен локальний сервер (start-chat.bat) - цифра береться
REM з Twitch через /api/viewers.
REM
REM У OBS: джерело "Браузер", URL http://localhost:3000/online.html?big=1

setlocal
set "RG_DIR=%~dp0"

REM якщо сервер ще не запущений - запускаємо фоном
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "if (-not (Test-NetConnection -ComputerName localhost -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue).TcpTestSucceeded) { Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%RG_DIR%serve.ps1' -WindowStyle Hidden }"

timeout /t 1 /nobreak >nul

powershell -NoProfile -ExecutionPolicy Bypass -File "%RG_DIR%pin-chat.ps1" ^
  -Url "http://localhost:3000/online.html" -Match "1teroxx" -Width 320 -Height 220

pause
endlocal
