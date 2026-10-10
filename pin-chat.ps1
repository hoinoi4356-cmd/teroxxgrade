# ==========================================================================
# pin-chat.ps1 — вікно поверх усіх вікон (always on top)
#
# Відкриває задану сторінку у вікні браузера без вкладок (--app) і
# закріплює його поверх усіх вікон. Викликається з:
#   chat-window.bat    — чат Twitch
#   online-window.bat  — лічильник глядачів стріму
# ==========================================================================

param(
  [string]$Channel   = '1teroxx',
  [string]$Url       = '',
  [string]$Match     = '',
  [int]$Width    = 0,
  [int]$Height   = 0
)

$Channel = $Channel.ToLower() -replace '[^a-z0-9_]', ''
if (-not $Url) { $Url = "https://www.twitch.tv/popout/$Channel/chat" }
if (-not $Match) { $Match = [regex]::Escape($Channel) + '|Twitch' }

# --- шукаємо Chrome або Edge, щоб відкрити у режимі окремого вікна ------
$browser = $null
$candidates = @(
  (Join-Path $env:ProgramFiles        'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA        'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles        'Microsoft\Edge\Application\msedge.exe')
)
foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { $browser = $c; break } }

if ($browser) {
  $args = @("--app=$Url")
  if ($Width -gt 0 -and $Height -gt 0) { $args += "--window-size=$Width,$Height" }
  Start-Process $browser $args
} else {
  Start-Process $Url
  Write-Host "Браузер у режимі app не знайдено - вікно відкрите звичайно."
  exit
}

# --- чекаємо, поки вікно з'явиться, і закріплюємо поверх усіх ----------
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinPin {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder sb, int max);
  public static string Title(IntPtr h) {
    var sb = new System.Text.StringBuilder(512);
    GetWindowText(h, sb, 512);
    return sb.ToString();
  }
}
"@

$HWND_TOPMOST    = [IntPtr]::new(-1)
$SWP_NOSIZE      = 0x0001
$SWP_NOMOVE      = 0x0002
$SWP_SHOWWINDOW  = 0x0040

$procName = [System.IO.Path]::GetFileNameWithoutExtension($browser)
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 250
  $procs = Get-Process $procName -ErrorAction SilentlyContinue
  foreach ($p in $procs) {
    if ($p.MainWindowHandle -eq 0) { continue }
    $title = [WinPin]::Title($p.MainWindowHandle)
    if ($title -match $Match) {
      [WinPin]::SetWindowPos($p.MainWindowHandle, $HWND_TOPMOST, 0, 0, 0, 0,
        ($SWP_NOSIZE -bor $SWP_NOMOVE -bor $SWP_SHOWWINDOW))
      Write-Host "Закріплено поверх усіх вікон: $title"
      exit
    }
  }
}
Write-Host "Вікно не знайдено за 10 секунд. Відкрийте вручну: $Url"
