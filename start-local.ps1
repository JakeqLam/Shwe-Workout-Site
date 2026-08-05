param(
  [switch]$Lan,
  [ValidateRange(1, 65535)]
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw "Node.js was not found. Install Node.js 24 LTS, reopen PowerShell, and run this script again."
}

$version = (& node -p "process.versions.node").Trim()
$parts = $version.Split('.')
$major = [int]$parts[0]
$minor = [int]$parts[1]
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 16)) {
  throw "Node.js $version is installed. This project requires Node.js 22.16 or newer; Node.js 24 LTS is recommended."
}

$env:PORT = "$Port"
$env:HOST = if ($Lan) { "0.0.0.0" } else { "127.0.0.1" }

Write-Host ""
Write-Host "Starting Plu's Workout Tracker..." -ForegroundColor Magenta
if ($Lan) {
  Write-Host "LAN mode is enabled. Windows Firewall may ask for permission." -ForegroundColor Yellow
}
Write-Host ""

& node "$PSScriptRoot\server.mjs"
