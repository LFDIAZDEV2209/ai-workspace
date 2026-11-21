param(
  [switch]$Apply
)

$ErrorActionPreference = "Continue"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$wtRoot = Join-Path $root ".worktrees"
# Fuera del workspace: los appsettings/.env pueden contener secretos locales.
$archiveRoot = Join-Path $env:USERPROFILE ".worktree-config-backups"

if (-not (Test-Path $wtRoot)) {
  Write-Output "No hay .worktrees"
  exit 0
}

function Get-WorktreeRepo($wtPath) {
  $gitFile = Join-Path $wtPath ".git"
  if (-not (Test-Path $gitFile)) { return $null }
  $line = Get-Content $gitFile -TotalCount 1
  if ($line -notmatch "^gitdir:\s*(.+)$") { return $null }
  $gitDir = $Matches[1].Trim()
  # <repo>/.git/worktrees/<name> -> <repo>
  $repo = Split-Path (Split-Path (Split-Path $gitDir -Parent) -Parent) -Parent
  return $repo
}

$removed = 0
$freedMb = 0

foreach ($wt in Get-ChildItem $wtRoot -Directory) {
  $repo = Get-WorktreeRepo $wt.FullName
  if (-not $repo -or -not (Test-Path $repo)) {
    Write-Output ("SKIP {0}: no se pudo resolver el repo" -f $wt.Name)
    continue
  }

  git -C $wt.FullName merge-base --is-ancestor HEAD origin/dev 2>$null
  $merged = ($LASTEXITCODE -eq 0)
  $dirty = @(git -C $wt.FullName status --porcelain 2>$null).Count

  if (-not $merged) {
    Write-Output ("SKIP {0}: no fusionado en origin/dev" -f $wt.Name)
    continue
  }
  if ($dirty -gt 0) {
    Write-Output ("SKIP {0}: {1} cambios sin commit" -f $wt.Name, $dirty)
    continue
  }

  $ignored = @(git -C $wt.FullName status --ignored --porcelain 2>$null |
    Where-Object { $_ -match "^!! " } |
    ForEach-Object { $_ -replace "^!! ", "" })

  $sensitive = @($ignored | Where-Object {
    $_ -match "(?i)(^|/)(\.env(\..*)?|appsettings(\..*)?\.json|.*secret.*|.*\.local)$"
  })

  $sizeMb = [math]::Round(((Get-ChildItem $wt.FullName -Recurse -File -Force -ErrorAction SilentlyContinue |
    Measure-Object Length -Sum).Sum) / 1MB)

  Write-Output ("CANDIDATE {0}: {1} MB, repo={2}, sensibles={3}" -f $wt.Name, $sizeMb, (Split-Path $repo -Leaf), ($sensitive -join ","))

  if (-not $Apply) {
    foreach ($rel in $sensitive) { Write-Output ("  would archive: {0}" -f $rel) }
    continue
  }

  foreach ($rel in $sensitive) {
    $src = Join-Path $wt.FullName $rel
    if (-not (Test-Path $src -PathType Leaf)) { continue }
    $dst = Join-Path (Join-Path $archiveRoot $wt.Name) $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
    Copy-Item $src $dst -Force
    Write-Output ("  archived: {0}" -f $rel)
  }

  git -C $repo worktree remove $wt.FullName 2>&1 | ForEach-Object { "  $_" }
  if ($LASTEXITCODE -eq 0) {
    $removed++
    $freedMb += $sizeMb
    Write-Output ("REMOVED {0}" -f $wt.Name)
  } else {
    Write-Output ("FAILED {0}: git worktree remove devolvio {1}" -f $wt.Name, $LASTEXITCODE)
  }
}

foreach ($repo in @("coppAddresdBack", "coppaddresd-front", "antares-paciente", "ai-service")) {
  $repoPath = Join-Path $root $repo
  if (Test-Path $repoPath) { git -C $repoPath worktree prune 2>$null }
}

if ($Apply) {
  Write-Output ("TOTAL removed={0}, freed={1} MB" -f $removed, $freedMb)
  Write-Output ("Configs archivadas en {0}" -f $archiveRoot)
} else {
  Write-Output "DRY-RUN: ejecuta con -Apply para borrar los CANDIDATE."
}
