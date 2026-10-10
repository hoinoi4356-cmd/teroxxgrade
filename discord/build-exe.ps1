$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

Add-Type -AssemblyName System.Drawing

# ---- 1. draw 256x256 icon ----
$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

function New-RoundRect([int]$x, [int]$y, [int]$w, [int]$h, [int]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$c1 = [System.Drawing.ColorTranslator]::FromHtml('#5865f2')
$c2 = [System.Drawing.ColorTranslator]::FromHtml('#7b5cf5')
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.Point(0,0)), (New-Object System.Drawing.Point($size,$size)), $c1, $c2)
$bgPath = New-RoundRect 8 8 ($size - 16) ($size - 16) 60
$g.FillPath($bg, $bgPath)

$white = [System.Drawing.Brushes]::White
$bubble = New-RoundRect 50 58 156 112 36
$g.FillPath($white, $bubble)
$tail = @(
  (New-Object System.Drawing.Point(92, 162)),
  (New-Object System.Drawing.Point(126, 162)),
  (New-Object System.Drawing.Point(94, 196))
)
$g.FillPolygon($white, $tail)

$dot = New-Object System.Drawing.SolidBrush($c1)
foreach ($cx in 92, 128, 164) { $g.FillEllipse($dot, ($cx - 10), 104, 20, 20) }

$g.Dispose()
$pngPath = Join-Path $dir 'icon256.png'
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

# ---- 2. wrap PNG into .ico ----
$png = [System.IO.File]::ReadAllBytes($pngPath)
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
$bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0)
$bw.Write([UInt16]1); $bw.Write([UInt16]32)
$bw.Write([UInt32]$png.Length); $bw.Write([UInt32]22)
$bw.Write($png)
$bw.Flush()
$icoPath = Join-Path $dir 'icon.ico'
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
$bw.Dispose(); $ms.Dispose()

# ---- 3. compile exe (relative names, no spaces) ----
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
$cscArgs = @('/nologo', '/target:winexe', '/codepage:65001', '/win32icon:icon.ico',
  '/out:Messenger.exe', 'launcher.cs', '/r:System.Windows.Forms.dll')
& $csc $cscArgs
if (Test-Path (Join-Path $dir 'Messenger.exe')) { Write-Host 'OK: Messenger.exe' } else { throw 'compile failed' }
