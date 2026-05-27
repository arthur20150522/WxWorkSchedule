# Deploy Script for WxSchedule (wx4py edition)
# Target: Windows Server 2025 at 39.106.127.176
# Usage: .\deploy.ps1
#
# Prerequisites on remote server:
#   - Python 3.9+ + pip (pip install wx4py flask)
#   - Node.js 18+ + npm
#   - PM2 (npm install -g pm2)
#   - WeChat 4.x logged in and visible on desktop

$SERVER_IP = "39.106.127.176"
$REMOTE_DIR = "C:\WxSchedule"
$USER = "Administrator"

Write-Host "1. Building Client..." -ForegroundColor Cyan
Set-Location client
npm install
npm run build
Set-Location ..

Write-Host "2. Installing Server Dependencies..." -ForegroundColor Cyan
Set-Location server
npm install
Set-Location ..

Write-Host "3. Preparing Remote Directory..." -ForegroundColor Cyan
ssh $USER@$SERVER_IP "if not exist $REMOTE_DIR mkdir $REMOTE_DIR"
ssh $USER@$SERVER_IP "if not exist $REMOTE_DIR\client mkdir $REMOTE_DIR\client"
ssh $USER@$SERVER_IP "if not exist $REMOTE_DIR\server mkdir $REMOTE_DIR\server"
ssh $USER@$SERVER_IP "if not exist $REMOTE_DIR\server\pybridge mkdir $REMOTE_DIR\server\pybridge"

Write-Host "4. Uploading Client Files..." -ForegroundColor Cyan
scp -r client/dist/* "${USER}@${SERVER_IP}:$REMOTE_DIR/client/"

Write-Host "5. Uploading Server Files..." -ForegroundColor Cyan
scp -r server/dist/* "${USER}@${SERVER_IP}:$REMOTE_DIR/server/"
scp server/package.json "${USER}@${SERVER_IP}:$REMOTE_DIR/server/"
scp -r server/pybridge/* "${USER}@${SERVER_IP}:$REMOTE_DIR/server/pybridge/"

# .env and .user are NOT copied — preserve production credentials

Write-Host "6. Installing Python dependencies on Remote..." -ForegroundColor Cyan
ssh $USER@$SERVER_IP "pip install -r $REMOTE_DIR\server\pybridge\requirements.txt"

Write-Host "7. Installing Server Dependencies on Remote..." -ForegroundColor Cyan
ssh $USER@$SERVER_IP "cd $REMOTE_DIR\server && npm install --production"

Write-Host "8. Starting Services with PM2..." -ForegroundColor Cyan
# Start wx4py bridge (Python)
ssh $USER@$SERVER_IP "pm2 restart wx4py-bridge || pm2 start $REMOTE_DIR\server\pybridge\bridge.py --name wx4py-bridge --interpreter python -- --port 39800 && pm2 save"
# Start Node.js API server
ssh $USER@$SERVER_IP "pm2 restart wx-schedule-server || pm2 start $REMOTE_DIR\server\dist\index.js --name wx-schedule-server && pm2 save"

Write-Host ""
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "─────────────────────────────────────────────" -ForegroundColor Green
Write-Host "Bridge:  http://39.106.127.176:39800/health"
Write-Host "API:     http://39.106.127.176:3000/api/status"
Write-Host "Web UI:  http://39.106.127.176"
Write-Host "─────────────────────────────────────────────" -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT: Ensure WeChat 4.x is logged in and visible on the server desktop!"
Write-Host ""
