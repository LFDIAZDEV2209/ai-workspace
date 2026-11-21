param(
  [switch]$Disk,
  [switch]$Clean
)

$ErrorActionPreference = "SilentlyContinue"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")

function Section($name) { Write-Output ""; Write-Output "== $name ==" }

Section "Sistema"
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
"CPU: {0} ({1}C/{2}T) carga={3}%" -f $cpu.Name, $cpu.NumberOfCores, $cpu.NumberOfLogicalProcessors, $cpu.LoadPercentage
"RAM: {0:N1} GB libre de {1:N1} GB" -f ($os.FreePhysicalMemory / 1MB), ($cs.TotalPhysicalMemory / 1GB)
"Uptime: {0}" -f ((Get-Date) - $os.LastBootUpTime).ToString("d\d\ hh\h\ mm\m")
"Discos:"
Get-Volume | Where-Object DriveLetter | Select-Object DriveLetter, @{n = "FreeGB"; e = { [math]::Round($_.SizeRemaining / 1GB, 1) } }, @{n = "SizeGB"; e = { [math]::Round($_.Size / 1GB, 1) } }, HealthStatus | Format-Table -AutoSize

Section "Seguridad"
Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | Select-Object displayName, productState | Format-Table -AutoSize
Get-MpComputerStatus | Select-Object AntivirusEnabled, RealTimeProtectionEnabled | Format-Table -AutoSize

Section "Top RAM"
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 12 Name, Id, @{n = "MB"; e = { [math]::Round($_.WorkingSet64 / 1MB) } } | Format-Table -AutoSize

Section "Procesos dev"
Get-CimInstance Win32_Process | Where-Object { $_.Name -match "^(node|opencode|dotnet|python|java|chrome|msedge|Code|Docker Desktop)\.exe$" } | Group-Object Name | Sort-Object Count -Descending | Format-Table Count, Name -AutoSize

Section "Puertos del stack"
$ports = @(5432, 6379, 5122, 5123, 5080, 8000, 8010, 9999, 28894)
Get-NetTCPConnection -State Listen | Where-Object { $ports -contains $_.LocalPort } | ForEach-Object {
  $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  "port={0} pid={1} proc={2} addr={3}" -f $_.LocalPort, $_.OwningProcess, $p.ProcessName, $_.LocalAddress
}

Section "Worktrees / caches"
$wt = Join-Path $root ".worktrees"
if (Test-Path $wt) {
  "worktrees: " + ((Get-ChildItem $wt -Directory | Measure-Object).Count)
}
if ($Disk) {
  function DirGB($p) {
    if (-not (Test-Path $p)) { return 0 }
    $s = (Get-ChildItem $p -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    return [math]::Round($s / 1GB, 2)
  }
  "Repos GB: " + (DirGB $root)
  ".worktrees GB: " + (DirGB $wt)
  ".codegraph GB: " + (DirGB (Join-Path $root ".codegraph"))
  "openspec GB: " + (DirGB (Join-Path $root "openspec"))
  $caches = [ordered]@{
    "npm-cache"     = "$env:LOCALAPPDATA\npm-cache"
    "pnpm"          = "$env:LOCALAPPDATA\pnpm"
    "yarn"          = "$env:LOCALAPPDATA\Yarn"
    "uv"            = "$env:LOCALAPPDATA\uv"
    "pip"           = "$env:LOCALAPPDATA\pip\Cache"
    "ms-playwright" = "$env:LOCALAPPDATA\ms-playwright"
    "Temp"          = "$env:LOCALAPPDATA\Temp"
  }
  foreach ($k in $caches.Keys) { "{0} GB: {1}" -f $k, (DirGB $caches[$k]) }
}

if ($Clean) {
  Section "Limpieza segura"
  # Temp: solo ficheros con mas de 7 dias; nunca toca procesos vivos.
  $cutoff = (Get-Date).AddDays(-7)
  $temp = $env:TEMP
  $old = @(Get-ChildItem $temp -Force -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cutoff })
  $old | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  "Temp >7d eliminado: {0} elementos" -f $old.Count

  if (Get-Command npm -ErrorAction SilentlyContinue) { npm cache verify 2>$null | Out-Null; "npm cache verify OK" }
  if (Get-Command pnpm -ErrorAction SilentlyContinue) { pnpm store prune 2>$null | Out-Null; "pnpm store prune OK" }
  if (Get-Command yarn -ErrorAction SilentlyContinue) { yarn cache clean 2>$null | Out-Null; "yarn cache clean OK" }
  if (Get-Command uv -ErrorAction SilentlyContinue) { uv cache prune 2>$null | Out-Null; "uv cache prune OK" }
  if (Get-Command pip -ErrorAction SilentlyContinue) { pip cache purge 2>$null | Out-Null; "pip cache purge OK" }
  if (Get-Command dotnet -ErrorAction SilentlyContinue) { dotnet nuget locals http-cache --clear 2>$null | Out-Null; "nuget http-cache clear OK" }
}

Write-Output ""
Write-Output "OK. No se han matado procesos ni tocado worktrees/node_modules/Playwright."
