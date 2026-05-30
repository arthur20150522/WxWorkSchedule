# Push local code to git, then pull + build + restart on server
# Usage: .\deploy.ps1

$ErrorActionPreference = "Stop"
$SERVER = "Administrator@39.106.127.176"
$REMOTE = "C:\Users\Administrator\WxWorkSchedule"

Write-Host "1. Pushing to git..." -ForegroundColor Cyan
git add -A
git commit -m "deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git push origin fork4win

Write-Host "2. Pull + build + restart on server..." -ForegroundColor Cyan
ssh $SERVER "cd $REMOTE && git fetch origin fork4win && git reset --hard origin/fork4win && powershell -File remote_deploy.ps1"

Write-Host ""
Write-Host "Done! http://39.106.127.176:3000" -ForegroundColor Green
