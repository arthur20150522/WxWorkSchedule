@echo off
title WxSchedule Starter
echo Starting WxSchedule services...

REM 1. Start Node via PM2
cd /d C:\Users\Administrator\WxWorkSchedule\server\dist
call pm2 start ecosystem.config.cjs 2>nul
call pm2 save 2>nul
echo [OK] Node (PM2)

REM 2. Start Bridge in minimized window
start /min "WxBridge" C:\Python314\python.exe C:\Users\Administrator\WxWorkSchedule\server\pybridge\bridge.py
echo [OK] Bridge (minimized)

echo.
echo All services started.
echo Page: http://localhost:3000
timeout /t 5
