# Ставит RustBot на автозапуск при входе в Windows.
#  1) пробует создать задачу в Планировщике (при входе пользователя);
#  2) если нет прав — кладёт ярлык в папку «Автозагрузка».
# Запуск: powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$vbs = Join-Path $root 'run-hidden.vbs'
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'

if (-not (Test-Path $vbs)) {
  Write-Error "Не найден $vbs"
  exit 1
}

$taskName = 'RustBot'

# --- 1) Планировщик задач ---------------------------------------------------
$taskOk = $false
try {
  $action = New-ScheduledTaskAction -Execute $wscript -Argument "`"$vbs`"" -WorkingDirectory $root
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  $taskOk = $true
  Write-Output "OK: задача '$taskName' создана (запуск при входе в Windows)."
} catch {
  Write-Output ("Планировщик недоступен: " + $_.Exception.Message)
}

# --- 2) Запасной вариант: папка «Автозагрузка» -------------------------------
if (-not $taskOk) {
  try {
    $startup = [Environment]::GetFolderPath('Startup')
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut((Join-Path $startup 'RustBot.lnk'))
    $lnk.TargetPath = $wscript
    $lnk.Arguments = "`"$vbs`""
    $lnk.WorkingDirectory = $root
    $lnk.WindowStyle = 7
    $lnk.Description = 'RustBot autostart'
    $lnk.Save()
    Write-Output "OK: ярлык RustBot добавлен в Автозагрузку ($startup)."
  } catch {
    Write-Error ("Не удалось поставить на автозапуск: " + $_.Exception.Message)
    exit 1
  }
}

Write-Output "Проверка:"
if ($taskOk) {
  Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State | Format-Table -AutoSize
} else {
  Write-Output ("  " + (Join-Path ([Environment]::GetFolderPath('Startup')) 'RustBot.lnk'))
}
