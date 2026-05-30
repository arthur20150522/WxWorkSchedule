@echo off
title WxSchedule Launcher
set "ROOT=E:\Python Project\WxWorkSchedule"

:MENU
cls
echo.
echo  ============================================
echo         WxSchedule Launcher
echo  ============================================
echo.
echo   1. Install dependencies (run once)
echo   2. Start all (background + minimized)
echo   3. Start backend only
echo   4. Start frontend only
echo   5. Stop all
echo   6. Check status
echo   7. Environment diagnose
echo   0. Exit
echo.
echo  ============================================
set /p choice=Select [0-7]:

if "%choice%"=="1" goto INSTALL
if "%choice%"=="2" goto START_ALL
if "%choice%"=="3" goto START_BE
if "%choice%"=="4" goto START_FE
if "%choice%"=="5" goto STOP
if "%choice%"=="6" goto STATUS
if "%choice%"=="7" goto DIAG
if "%choice%"=="0" exit /b 0
goto MENU

:INSTALL
cls
echo.
echo  [1/5] Checking Node.js ...
where node
if %errorlevel% neq 0 (
    echo   [FAIL] Node.js not found. Install from https://nodejs.org
    pause
    goto MENU
)
for /f "tokens=*" %%v in ('node --version') do echo   OK: Node.js %%v

echo.
echo  [2/5] Checking Python ...
where python
if %errorlevel% neq 0 (
    echo   [FAIL] Python not found.
    pause
    goto MENU
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo   OK: Python %%v

echo.
echo  [3/5] Installing server dependencies ...
cd /d "%ROOT%\server"
if not exist node_modules (
    call npm install
    if %errorlevel% neq 0 (
        echo   [FAIL] Server npm install failed
        pause
        goto MENU
    )
    echo   OK: Server deps installed
) else (
    echo   SKIP: Server node_modules already exists
)

echo.
echo  [4/5] Installing client dependencies ...
cd /d "%ROOT%\client"
if not exist node_modules (
    call npm install
    if %errorlevel% neq 0 (
        echo   [FAIL] Client npm install failed
        pause
        goto MENU
    )
    echo   OK: Client deps installed
) else (
    echo   SKIP: Client node_modules already exists
)

echo.
echo  [5/5] Installing wx4py ...
pip install wx4py
if %errorlevel% neq 0 (
    echo   [WARN] wx4py install failed. Run manually: pip install wx4py
) else (
    echo   OK: wx4py installed
)

echo.
echo  ============================================
echo   All dependencies installed!
echo  ============================================
pause
goto MENU

:START_ALL
cls
echo.
if not exist "%ROOT%\server\node_modules" (
    echo   [FAIL] Server deps missing. Run option 1 first.
    pause
    goto MENU
)
if not exist "%ROOT%\client\node_modules" (
    echo   [FAIL] Client deps missing. Run option 1 first.
    pause
    goto MENU
)
echo  [1/3] Starting Bridge (minimized) ...
cd /d "%ROOT%\server\pybridge"
start "WxSvcBridge" /MIN cmd /k "python bridge.py"
timeout /t 3 >nul

echo  [2/3] Starting Server (minimized) ...
cd /d "%ROOT%\server"
start "WxSvcServer" /MIN cmd /k "call npm run dev"
timeout /t 4 >nul

echo  [3/3] Starting Frontend (minimized) ...
cd /d "%ROOT%\client"
start "WxSvcFront" /MIN cmd /k "call npm run dev"

echo.
echo  ============================================
echo   All started in background!
echo  ============================================
echo.
echo   Bridge  : http://127.0.0.1:39800
echo   Server  : http://localhost:3000
echo   UI      : http://localhost:5173
echo.
echo   WARNING:
echo   - Keep WeChat window in foreground during sending
echo   - Do NOT click other windows while wx4py is working
echo.
pause
goto MENU

:START_BE
cls
echo.
if not exist "%ROOT%\server\node_modules" (
    echo   [FAIL] Server deps missing. Run option 1 first.
    pause
    goto MENU
)
echo  [1/2] Starting Bridge (minimized) ...
cd /d "%ROOT%\server\pybridge"
start "WxSvcBridge" /MIN cmd /k "python bridge.py"
timeout /t 3 >nul

echo  [2/2] Starting Server (minimized) ...
cd /d "%ROOT%\server"
start "WxSvcServer" /MIN cmd /k "call npm run dev"

echo.
echo   Backend started in background.
echo.
pause
goto MENU

:START_FE
cls
echo.
if not exist "%ROOT%\client\node_modules" (
    echo   [FAIL] Client deps missing. Run option 1 first.
    pause
    goto MENU
)
echo  Starting Frontend (minimized) ...
cd /d "%ROOT%\client"
start "WxSvcFront" /MIN cmd /k "call npm run dev"

echo.
echo   Frontend started in background.
echo.
pause
goto MENU

:STOP
cls
echo.
echo  Stopping all services ...
taskkill /FI "WINDOWTITLE eq WxSvcBridge" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq WxSvcServer" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq WxSvcFront" /F >nul 2>&1
echo   All stopped.
echo.
pause
goto MENU

:STATUS
cls
echo.
echo  ============================================
echo   Service Status
echo  ============================================
echo.
echo  [Bridge :39800]
netstat -ano | find ":39800" >nul 2>&1
if %errorlevel%==0 (echo     RUNNING) else (echo     STOPPED)
echo.
echo  [Server :3000]
netstat -ano | find ":3000" >nul 2>&1
if %errorlevel%==0 (echo     RUNNING) else (echo     STOPPED)
echo.
echo  [Frontend :5173]
netstat -ano | find ":5173" >nul 2>&1
if %errorlevel%==0 (echo     RUNNING) else (echo     STOPPED)
echo.
echo  ============================================
pause
goto MENU

:DIAG
cls
echo.
echo  ============================================
echo   Environment Diagnose
echo  ============================================
echo.
where node
if %errorlevel%==0 (for /f "tokens=*" %%v in ('node --version') do echo   [OK] Node.js %%v) else (echo   [FAIL] Node.js not found)

where npm
if %errorlevel%==0 (for /f "tokens=*" %%v in ('npm --version') do echo   [OK] npm %%v) else (echo   [FAIL] npm not found)

where python
if %errorlevel%==0 (for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo   [OK] Python %%v) else (echo   [FAIL] Python not found)

pip show wx4py
if %errorlevel%==0 (echo   [OK] wx4py installed) else (echo   [FAIL] wx4py not found)

if exist "%ROOT%\server\node_modules" (echo   [OK] server/node_modules) else (echo   [FAIL] server/node_modules missing)
if exist "%ROOT%\client\node_modules" (echo   [OK] client/node_modules) else (echo   [FAIL] client/node_modules missing)
if exist "%ROOT%\server\.env" (echo   [OK] server/.env) else (echo   [FAIL] server/.env missing)
if exist "%ROOT%\server\.user" (echo   [OK] server/.user) else (echo   [--] server/.user - will be created on first start)

echo.
echo  ============================================
pause
goto MENU
