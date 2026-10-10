# Enable RustBot autostart at Windows logon via Startup-folder shortcut (no admin needed)
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs = Join-Path $dir 'run-hidden.vbs'
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'RustBot.lnk'

$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = 'wscript.exe'
$sc.Arguments = '"' + $vbs + '"'
$sc.WorkingDirectory = $dir
$sc.Description = 'RustBot: Discord-Rust bridge (autostart at logon)'
$sc.WindowStyle = 7
$sc.Save()

Write-Host ''
Write-Host 'Autostart enabled:' ("  " + $lnk)
Write-Host ''
Write-Host 'Bot will start at next Windows logon (hidden, logs in logs\rustbot.log).'
Write-Host 'To disable: run uninstall-autostart.bat'