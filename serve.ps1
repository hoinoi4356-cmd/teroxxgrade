# ==========================================================================
# serve.ps1 — статичний сервер + проксі «онлайн стріму»
#
# Навіщо: на цьому комп'ютері немає Node.js чи Python, а чат Twitch
# (chat.html) працює лише по http — Twitch вкладає чат в iframe і
# вимагає параметр parent = хост сторінки. file:// не підходить.
#
# Додатково віддає /api/viewers — лічильник глядачів Twitch-стріму.
# У браузері напряму до gql.twitch.tv не вийде (CORS), тому запит
# проксіюється звідси, через PowerShell.
#
# Запуск:  двічі клацніть start-chat.bat (або serve.ps1)
# Потім в OBS: джерело «Браузер», URL  http://localhost:3000/chat.html
# ==========================================================================

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 3000
$prefix = "http://localhost:$port/"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$mimes = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.webp' = 'image/webp'
  '.ico'  = 'image/x-icon'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Write-Host "Порт $port зайнятий або доступ заборонено."
  Write-Host "Спробуйте інший порт, змінивши `$port у serve.ps1"
  exit 1
}

Write-Host "rustgrade/chat: $prefix  (Ctrl+C - зупинити)"

# --------------------------------------------------- лічильник глядачів

$VG_TTL   = 10000        # мс: не дзвонимо в Twitch частіше, ніж раз на 10 с
$vgCache  = @{ at = 0; login = ''; data = $null }

function Get-Viewers($ch) {
  $now  = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  if ($vgCache.data -and $vgCache.login -eq $ch -and ($now - $vgCache.at) -lt $VG_TTL) {
    return $vgCache.data
  }

  $body = '{"query":"query{user(login:\"' + $ch + '\"){login stream{viewersCount title}}}"}'
  $out  = @{ ok = $false; login = $ch; live = $false; viewers = 0; title = '' }
  try {
    $r = Invoke-WebRequest -Uri 'https://gql.twitch.tv/gql' -Method Post `
      -ContentType 'application/json' -UseBasicParsing -TimeoutSec 8 `
      -Headers @{ 'Client-ID' = 'kimne78kx3ncx6brgo4mv6wki5h1ko' } `
      -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
    $j    = $r.Content | ConvertFrom-Json
    $user = $j.data.user
    if ($user) {
      $out.ok      = $true
      $out.login   = $user.login
      $out.live    = $null -ne $user.stream
      $out.viewers = if ($out.live) { [int]$user.stream.viewersCount } else { 0 }
      $out.title   = if ($out.live) { [string]$user.stream.title } else { '' }
    }
  } catch {
    # залишаємо попередній кеш, якщо він є
    if ($vgCache.data -and $vgCache.login -eq $ch) { return $vgCache.data }
  }

  $vgCache.at    = $now
  $vgCache.login = $ch
  $vgCache.data  = $out
  return $out
}

function Send-JSON($ctx, $obj, $code) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $obj -Compress -Depth 5))
  $ctx.Response.StatusCode = if ($code) { $code } else { 200 }
  $ctx.Response.ContentType = 'application/json; charset=utf-8'
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}

# --------------------------------------------------------------- цикл

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $urlPath = $ctx.Request.Url.AbsolutePath

  # --- GET /api/viewers?ch=1teroxx ---
  if ($urlPath -eq '/api/viewers') {
    $ch = $ctx.Request.QueryString['ch']
    if (-not $ch) { $ch = '1teroxx' }
    $ch = ($ch.ToLower() -replace '[^a-z0-9_]', '')
    if (-not $ch) { $ch = '1teroxx' }
    Send-JSON $ctx (Get-Viewers $ch)
    continue
  }

  if ($urlPath -eq '/') { $urlPath = '/index.html' }

  # захист від виходу за межі папки
  $rel = [System.Uri]::UnescapeDataString($urlPath).Replace('/', '\').TrimStart('\')
  $full = Join-Path $root $rel
  $rootFull = (Resolve-Path $root).Path
  $ok = $false
  try {
    $resolved = (Resolve-Path $full).Path
    $ok = $resolved.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)
  } catch { $ok = $false }

  if (-not $ok -or -not (Test-Path $full -PathType Leaf)) {
    $buf = [System.Text.Encoding]::UTF8.GetBytes('404')
    $ctx.Response.StatusCode = 404
    $ctx.Response.ContentType = 'text/plain; charset=utf-8'
    $ctx.Response.OutputStream.Write($buf, 0, $buf.Length)
    $ctx.Response.Close()
    continue
  }

  $ext = [System.IO.Path]::GetExtension($full).ToLower()
  $bytes = [System.IO.File]::ReadAllBytes($full)
  $ctx.Response.StatusCode = 200
  $ctx.Response.ContentType = $mimes[$ext]
  if (-not $ctx.Response.ContentType) { $ctx.Response.ContentType = 'application/octet-stream' }
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}
