param(
  [int]$Total = 5499,
  [int]$DelayMs = 1500,
  [string]$Dir = "C:\Users\hoino\AppData\Local\Temp\opencode\pages"
)

if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
Add-Type -AssemblyName System.Net.Http

$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromSeconds(45)
$client.DefaultRequestHeaders.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')
$client.DefaultRequestHeaders.Add('Accept-Language', 'en-US,en;q=0.9')

$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
$pages = [int][math]::Ceiling($Total / 10)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$ok = 0; $bad = 0; $skip = 0; $cool = 0

Write-Host "start pages=$pages delay=$DelayMs"

for ($p = 0; $p -lt $pages; $p++) {
    $file = Join-Path $Dir ("p{0:d4}.json" -f $p)
    if (Test-Path $file) { $skip++; continue }

    $url = "https://steamcommunity.com/market/search/render/?appid=252490&norender=1&start=$($p * 10)"

    $text = $null
    $attempt = 0
    while (-not $text -and $attempt -lt 12) {
        $attempt++
        try { $text = $client.GetStringAsync($url).Result }
        catch {
            $text = $null
            $cool++
            $wait = [Math]::Min(180, 20 * $attempt)
            Write-Host ("  429/backoff on page {0}, wait {1}s (attempt {2})" -f $p, $wait, $attempt)
            Start-Sleep -Seconds $wait
        }
    }

    if ($text -and $text -match '"results"') {
        [System.IO.File]::WriteAllText($file, $text, (New-Object System.Text.UTF8Encoding $false))
        $ok++
    } else {
        $bad++
    }

    Start-Sleep -Milliseconds $DelayMs
    if (($p % 25) -eq 0) { Write-Host ("page {0}/{1} ok={2} bad={3} skip={4} cool={5} {6:n0}s" -f $p, $pages, $ok, $bad, $skip, $cool, $sw.Elapsed.TotalSeconds) }
}

Write-Host "DONE pages=$pages ok=$ok bad=$bad skip=$skip dir=$Dir"
