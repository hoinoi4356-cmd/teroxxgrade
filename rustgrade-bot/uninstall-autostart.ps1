# Disable RustBot autostart
$ErrorActionPreference = 'Continue'
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'RustBot.lnk'
if (Test-Path $lnk) {
  Remove-Item $lnk -Force
  Write-Host 'Startup shortcut removed.'
} else {
  Write-Host 'No startup shortcut found.'
}
Unregister-ScheduledTask -TaskName 'RustBot' -Confirm:$false -ErrorAction SilentlyContinue