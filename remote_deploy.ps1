# Run on server AFTER git pull
# Usage: powershell -File remote_deploy.ps1

$ErrorActionPreference = "Stop"
$BASE = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "1. Install server deps + compile..." -ForegroundColor Cyan
Set-Location "$BASE\server"
npm install
npx tsc

Write-Host "2. Install client deps + build..." -ForegroundColor Cyan
Set-Location "$BASE\client"
npm install
npm run build

Write-Host "3. Restart PM2..." -ForegroundColor Cyan
pm2 restart all

Write-Host ""
Write-Host "Deploy done! http://39.106.127.176:3000" -ForegroundColor Green
