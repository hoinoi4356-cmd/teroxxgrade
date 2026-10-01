param(
  [string]$Pages = "C:\Users\hoino\AppData\Local\Temp\opencode\pages",
  [string]$Project = "C:\Users\hoino\OneDrive\Документи\Default Project",
  [int]$PngSize = 96
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- зібрати --
$seen = @{}
$items = New-Object System.Collections.Generic.List[object]

foreach ($f in (Get-ChildItem $Pages -Filter 'p*.json' | Sort-Object Name)) {
    $raw = [System.IO.File]::ReadAllText($f.FullName)
    $j = $raw | ConvertFrom-Json
    if (-not $j.results) { continue }
    foreach ($r in $j.results) {
        $ad = $r.asset_description
        if (-not $ad -or -not $ad.icon_url) { continue }
        if ($seen.ContainsKey($ad.classid)) { continue }

        $usd = [Math]::Round(([double]$r.sell_price) / 100.0, 2)
        if ($usd -le 0) { continue }

        $hash = $ad.icon_url
        $bg = $ad.background_color
        if (-not $bg) { $bg = '161616' }

        $seen[$ad.classid] = $true
        $items.Add([pscustomobject]@{
            Name     = [string]$r.name
            Usd      = $usd
            Listings = [int]$r.sell_listings
            ClassId  = [string]$ad.classid
            Hash     = [string]$hash
            Bg       = ([string]$bg).ToLowerInvariant()
        })
    }
}

Write-Host ("items: {0}" -f $items.Count)

# ------------------------------------------------------------ категоризація --
# Назви скінів Rust закінчуються кодом зброї: AR, SAR, SAP, DBS, LR, SMG, M39...
# Тому збіг має бути по СЛОВУ, а не підрядком (щоб "Rainbow" не давало "bow").
$CAT_RULES = [ordered]@{
    rifle = @(
        '\b(ak47|ak-?47|ak74u?|lr-?300|lr300|hk416|m249|hmlmg|lmg|mk18|m39|sar|ar)\b',
        'assault rifle|semi-?automatic rifle|bolt rifle|rifle|cyberarmor'
    )
    smg = @('\b(smg|mp5|thompson|vector|custom smg|nail ?gun|mp5a4)\b')
    shotgun = @('\b(shotgun|scattergun|dbs|pump action|pump|spas-?12|eoka|bailer|double barrel|triple barrel)\b')
    sniper = @('\b(sks|m93|m1a|bolt action|hunting rifle|sniper|l96)\b')
    pistol = @('\b(pistol|revolver|python|desert eagle|m92|handmade|magnum|p250|proto|handgun|eoka pisto|sap)\b', 'pistol')
    bow = @('\b(bow|crossbow|arrow|zombow)\b')
    melee = @(
        '\b(spear|sword|kukri|knife|cleaver|machete|mace|jackhammer|chainsaw|hatchet|ice ?pick|salvaged|axe|hammer|sickle|katana|boar tusk|blade|pickaxe|sledge|warhammer|torch|crowbar|chawka|smg hammer)\b',
        'salvaged'
    )
    armor = @(
        '\b(vest|hazmat|riot|tank|kevlar|facemask|face ?mask|helmet|bucket|armor|armour|chest ?plate|gasmask)\b',
        'plate carrier|road ?sign'
    )
    clothing = @(
        '\b(jacket|shirt|pants|shoe|boot|glove|coat|hoodie|hat|bandana|wrap|sunglass|belt|suit|dress|uniform|scarf|cap|mask|balaclava|poncho|hood|jeans|beanie|backpack|bag|kilt|shorts|overalls|skirt|costume|jumpsuit|apron|blouse|sleeve|flannel|beret|turban|kimono|sarong|tunic|top|bottom|boots|mittens|gauntlets|tshirt|t-shirt|clothes|robe|towel)\b',
        'camouflage|camo|camouflaged'
    )
    vehicle = @('\b(bike|car|truck|boat|heli|heli ?copter|helicopter|submarine|rowboat|minicopter|wheel|engine|module|chassis|seapunk|transport|motor|quad|vehicle|diesel tank)\b')
    deployable = @(
        '\b(door|barricade|gate|wall|floor|roof|ramp|window|hatch|box|crate|storage|bench|workbench|furnace|campfire|bed|locker|shop|sign|ladder|vending|garage|recycler|mixing table|purifier|sleeping bag|solar panel|battery|branch|turret|cupboard|barrel|shelf|fridge|freezer|lantern|banner|toilet|snowman|grill|basket|case|component|pipe|speaker|oven|planter|rug|picture|lamp|hinge|lock|flasher|clamp|dispenser|holder|desk|table|stove|bbq|generator|funeral pyre|tool cupboard|water ?barrel|trash|jug|vending machine)\b',
        'repair bench|research table|mixing table|water purifier'
    )
    resource = @(
        '\b(scrap|ore|cloth|leather|fur|feathers|charcoal|sulfur|gunpowder|fuel|oil|diesel|water|sand|wood|stone|bone|fat|hemp|fiber|polymer|tungsten|hydrogen|ferric|calcium|naptha|crusher|tech trash|computer station|rarefied|black oxide|propane|nitrogen|gasoline|explosives|ammo|ammunition|grenade|acid|explosive)\b',
        'high quality metal|low grade fuel|metal ore|low grade|metal fragments|refining|refinery|^metal\b|scrap metal|metal frags'
    )
}

$CAT_RX = [ordered]@{}
foreach ($k in $CAT_RULES.Keys) {
    $CAT_RX[$k] = @($CAT_RULES[$k] | ForEach-Object { [regex]::new($_, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase) })
}

function Get-Category([string]$name) {
    $best = 'misc'; $bestScore = 0
    foreach ($cat in $CAT_RULES.Keys) {
        $score = 0
        foreach ($rx in $CAT_RX[$cat]) {
            if ($rx.IsMatch($name)) { $score++ }
        }
        if ($score -gt $bestScore) { $bestScore = $score; $best = $cat }
    }
    if ($bestScore -eq 0) { return 'misc' }
    return $best
}
# --------------------------------------------------------------- рідкість --
$RARITY_STEPS = @(0.30, 1, 5, 20, 75, 250)
$RARITY_IDS   = @('common','uncommon','rare','unusual','epic','legendary')

function Get-Rarity([double]$usd) {
    for ($i = 0; $i -lt $RARITY_STEPS.Count; $i++) {
        if ($usd -lt $RARITY_STEPS[$i]) { return $RARITY_IDS[$i] }
    }
    return 'exotic'
}

# ------------------------------------------------------------------- ids ---
$usedIds = @{}
foreach ($it in $items) {
    $base = $it.Hash.Substring(0, 12)
    $id = $base
    if ($usedIds.ContainsKey($id)) { $id = ($base + $it.ClassId) }
    $usedIds[$id] = $true
    $it | Add-Member -NotePropertyName Id -NotePropertyValue $id
}

# ------------------------------------------------------------- запис JS ---
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("/* autogenerated: real Rust items from the Steam Community Market (appid 252490)")
[void]$sb.AppendLine("   row = [ id, name, usd, cat, rarity, bg, listings ] */")
[void]$sb.AppendLine("window.RG = window.RG || {};")
[void]$sb.AppendLine("RG.CATALOG_RAW = [")
foreach ($it in $items) {
    $cat = Get-Category $it.Name
    $rar = Get-Rarity $it.Usd
    $name = $it.Name -replace '\\', '\\\\' -replace '"', '\\"'
    [void]$sb.AppendLine("[""$($it.Id)"",""$name"",$($it.Usd.ToString([System.Globalization.CultureInfo]::InvariantCulture)),""$cat"",""$rar"",""$($it.Bg)"",$($it.Listings)],")
}
[void]$sb.AppendLine("];")
[void]$sb.AppendLine("")

$dataDir = Join-Path $Project "assets\data"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
$catalogPath = Join-Path $dataDir "catalog.js"
[System.IO.File]::WriteAllText($catalogPath, $sb.ToString(), (New-Object System.Text.UTF8Encoding $false))
Write-Host ("catalog: {0} bytes -> {1}" -f (Get-Item $catalogPath).Length, $catalogPath)

# ------------------------------------------------------------ список картинок --
$imgDir = "C:\Users\hoino\AppData\Local\Temp\opencode\img"
if (-not (Test-Path $imgDir)) { New-Item -ItemType Directory -Path $imgDir -Force | Out-Null }
$imgLines = New-Object System.Collections.Generic.List[string]
$byHash = @{}
foreach ($it in $items) {
    if (-not $byHash.ContainsKey($it.Hash)) {
        $byHash[$it.Hash] = @{ id = $it.Id; bg = $it.Bg }
    }
}
foreach ($h in $byHash.Keys) {
    $imgLines.Add("$h`t$($byHash[$h].id).jpg`t$($byHash[$h].bg)")
}
$listPath = Join-Path $imgDir "imglist.txt"
[System.IO.File]::WriteAllLines($listPath, $imgLines, (New-Object System.Text.UTF8Encoding $false))
Write-Host ("imglist: {0} unique images -> {1}" -f $imgLines.Count, $listPath)

# --------------------------------------------------------------- зведення --
$byCat = @{}
foreach ($it in $items) {
    $c = Get-Category $it.Name
    if (-not $byCat.ContainsKey($c)) { $byCat[$c] = 0 }
    $byCat[$c]++
}
Write-Host "--- categories ---"
foreach ($k in ($byCat.Keys | Sort-Object)) { Write-Host ("  {0,-11} {1}" -f $k, $byCat[$k]) }

$prices = $items | ForEach-Object { $_.Usd } | Sort-Object
Write-Host ("--- price --- min={0} p50={1} p90={2} max={3}" -f `
    $prices[0], $prices[[int]($prices.Count*0.5)], $prices[[int]($prices.Count*0.9)], $prices[-1])

Write-Host "--- sample names ---"
foreach ($g in @('rifle','smg','shotgun','sniper','pistol','bow','melee','armor','clothing','vehicle','deployable','resource','misc')) {
    $sample = $items | Where-Object { (Get-Category $_.Name) -eq $g } | Select-Object -First 5 -ExpandProperty Name
    Write-Host ("  {0,-11} {1}" -f $g, ($sample -join ' | '))
}
