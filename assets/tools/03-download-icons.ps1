param(
  [string]$List = "C:\Users\hoino\AppData\Local\Temp\opencode\img\imglist.txt",
  [string]$Dest = "C:\Users\hoino\AppData\Local\Temp\opencode\img\skins",
  [int]$Size = 128,
  [int]$Batch = 10,
  [int]$DelayMs = 80,
  [int]$Quality = 90
)

# Завантажує справжні іконки скінів Rust із CDN Steam Community Market,
# накладає їх на колір тла предмета (background_color) і зберігає як JPEG.
# PNG з прозорістю важить ~13 КБ, JPEG ~1.8 КБ — це вирішує проблему
# з 5000+ файлів у папці OneDrive.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $Dest)) { New-Item -ItemType Directory -Path $Dest -Force | Out-Null }

$all = @{}
foreach ($line in [System.IO.File]::ReadAllLines($List)) {
    if (-not $line.Trim()) { continue }
    $p = $line -split "`t"
    $all[$p[1]] = @{ hash = $p[0]; bg = if ($p.Count -ge 3) { $p[2] } else { '161616' } }
}

$files = @($all.Keys | Sort-Object)
$todo = New-Object System.Collections.Generic.List[string]
foreach ($f in $files) { if (-not (Test-Path (Join-Path $Dest $f))) { $todo.Add($f) } }
Write-Host ("total={0} todo={1}" -f $files.Count, $todo.Count)
if ($todo.Count -eq 0) { Write-Host "nothing to do"; exit 0 }

$jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }

function Convert-ToBg([int]$hex) {
    if (-not $hex -or $hex.Length -lt 6) { return [System.Drawing.Color]::FromArgb(255, 22, 22, 22) }
    $r = [Convert]::ToInt32($hex.Substring(0, 2), 16)
    $g = [Convert]::ToInt32($hex.Substring(2, 2), 16)
    $b = [Convert]::ToInt32($hex.Substring(4, 2), 16)
    return [System.Drawing.Color]::FromArgb(255, $r, $g, $b)
}

$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromSeconds(45)
$client.DefaultRequestHeaders.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')
$client.DefaultRequestHeaders.Add('Referer', 'https://steamcommunity.com/market/')
$client.MaxResponseContentBufferSize = 4MB

$encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$done = 0; $okc = 0; $badc = 0; $i = 0
$queue = $todo.ToArray()

while ($i -lt $queue.Count) {
    $n = [Math]::Min($Batch, $queue.Count - $i)
    $reqs = New-Object System.Collections.Generic.List[object]
    for ($k = 0; $k -lt $n; $k++) {
        $f = $queue[$i + $k]
        $url = "https://community.cloudflare.steamstatic.com/economy/image/$($all[$f].hash)/128fx128f"
        $reqs.Add(@($client.GetByteArrayAsync($url), $f))
    }
    $tarr = New-Object System.Collections.Generic.List[System.Threading.Tasks.Task]
    foreach ($r in $reqs) { $tarr.Add($r[0]) }
    try { [System.Threading.Tasks.Task]::WaitAll($tarr.ToArray()) } catch { }

    for ($k = 0; $k -lt $n; $k++) {
        $f = $reqs[$k][1]
        $done++
        if ($reqs[$k][0].Status -ne 'RanToCompletion') { $badc++; continue }
        $bytes = $reqs[$k][0].Result
        if (-not $bytes -or $bytes.Length -lt 200) { $badc++; continue }
        try {
            $ms = New-Object System.IO.MemoryStream(,$bytes)
            $src = [System.Drawing.Image]::FromStream($ms)
            $flat = New-Object System.Drawing.Bitmap $Size, $Size
            $g = [System.Drawing.Graphics]::FromImage($flat)
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $g.Clear((Convert-ToBg ([Convert]::ToInt32($all[$f].bg, 16))))
            $g.DrawImage($src, 0, 0, $Size, $Size)
            $g.Dispose(); $src.Dispose(); $ms.Dispose()
            $flat.Save((Join-Path $Dest $f), $jpeg, $encParams)
            $flat.Dispose()
            $okc++
        } catch { $badc++ }
    }
    $i += $n
    Start-Sleep -Milliseconds $DelayMs
    if (($done % 500) -lt $Batch) {
        $mb = [Math]::Round((Get-ChildItem $Dest | Measure-Object Length -Sum).Sum / 1MB, 1)
        Write-Host ("{0}/{1} ok={2} bad={3} {4:n0}s {5}MB" -f $done, $queue.Count, $okc, $badc, $sw.Elapsed.TotalSeconds, $mb)
    }
}

$total = Get-ChildItem $Dest
Write-Host ("DONE done={0} ok={1} bad={2} files={3} size={4:n1}MB dest={5}" -f `
    $done, $okc, $badc, $total.Count, (($total | Measure-Object Length -Sum).Sum / 1MB), $Dest)
