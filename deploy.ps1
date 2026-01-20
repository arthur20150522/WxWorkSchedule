# Deploy Script for WxWorkSchedule
# Usage: .\deploy.ps1

$SERVER_IP = "43.153.88.215"
$REMOTE_DIR = "/www/wwwroot/WxWork"
$USER = "root" # Assuming root, change if needed

Write-Host "1. Building Client..."
cd client
npm install
npm run build
cd ..

Write-Host "2. Building Server..."
cd server
npm install
npm run build
cd ..

Write-Host "3. Preparing Remote Directory..."
ssh $USER@$SERVER_IP "mkdir -p $REMOTE_DIR/client $REMOTE_DIR/server"

Write-Host "4. Uploading Client Files..."
scp -r client/dist/* "${USER}@${SERVER_IP}:${REMOTE_DIR}/client/"

Write-Host "5. Uploading Server Files..."
# Copy dist, package.json, and other necessary files
scp -r server/dist/* "${USER}@${SERVER_IP}:${REMOTE_DIR}/server/"
scp server/package.json "${USER}@${SERVER_IP}:${REMOTE_DIR}/server/"
scp server/.env "${USER}@${SERVER_IP}:${REMOTE_DIR}/server/"
# Note: .user and users/ directory are not copied to preserve production data
# If this is a fresh install, you might need to create them manually or let the app do it

Write-Host "6. Installing Server Dependencies on Remote..."
ssh $USER@$SERVER_IP "cd $REMOTE_DIR/server && npm install --production"

Write-Host "7. Starting/Restarting Server with PM2..."
# Check if PM2 is installed, if not install it
ssh $USER@$SERVER_IP "if ! command -v pm2 &> /dev/null; then npm install -g pm2; fi"
# Start or Reload
ssh $USER@$SERVER_IP "cd $REMOTE_DIR/server && pm2 start index.js --name wx-schedule || pm2 reload wx-schedule"

Write-Host "Deployment Complete!"
Write-Host "Please ensure Nginx is configured to serve $REMOTE_DIR/client and proxy /api to localhost:3000"
