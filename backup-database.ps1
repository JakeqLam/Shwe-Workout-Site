$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$db = Join-Path $PSScriptRoot "data\workouts.db"
if (-not (Test-Path -LiteralPath $db)) {
  throw "No database exists yet. Save at least one workout before creating a database backup."
}

$backupDir = Join-Path $PSScriptRoot "backups"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$destination = Join-Path $backupDir "workouts-$stamp.db"
Copy-Item -LiteralPath $db -Destination $destination -Force
Write-Host "Database backup created:" -ForegroundColor Green
Write-Host $destination
