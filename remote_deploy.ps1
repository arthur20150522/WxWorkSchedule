# Remote deploy script — run on server (39.106.127.176)
# Usage: powershell -File remote_deploy.ps1

$ErrorActionPreference = "Stop"
$BASE = "C:\Users\Administrator\WxWorkSchedule"

Write-Host "1. Pull latest code..." -ForegroundColor Cyan
Set-Location $BASE
git fetch origin fork4win
git reset --hard origin/fork4win

Write-Host "2. Install server deps + compile..." -ForegroundColor Cyan
Set-Location "$BASE\server"
npm install
npx tsc

Write-Host "3. Install client deps + build..." -ForegroundColor Cyan
Set-Location "$BASE\client"
npm install
npm run build

Write-Host "4. Restart services..." -ForegroundColor Cyan
pm2 restart all

Write-Host ""
Write-Host "Deploy done! http://39.106.127.176" -ForegroundColor Green
