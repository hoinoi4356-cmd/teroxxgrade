$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

# "Месенджер" built from code points so this file stays pure ASCII
$name = -join ([char]0x041C,[char]0x0435,[char]0x0441,[char]0x0435,[char]0x043D,[char]0x0434,[char]0x0436,[char]0x0435,[char]0x0440)

$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$vbs = Join-Path $dir 'launch.vbs'
$ico = Join-Path $dir 'icon.ico'

if (-not (Test-Path $vbs)) { throw 'launch.vbs not found' }

$sh = New-Object -ComObject WScript.Shell
function Make-Shortcut([string]$path) {
  $l = $sh.CreateShortcut($path)
  $l.TargetPath = $wscript
  $l.Arguments = '"' + $vbs + '"'
  $l.IconLocation = $ico
  $l.WorkingDirectory = $dir
  $l.Description = $name
  $l.Save()
}

Make-Shortcut (Join-Path $dir ($name + '.lnk'))
Make-Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) ($name + '.lnk'))
Write-Host ('OK: shortcuts for ' + $name)
