@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "skip_browser="
if not "%~1"=="" (
  if /i not "%~1"=="--no-browser" (
    echo 用法：启动网页版.cmd [--no-browser]
    exit /b 1
  )
  set "skip_browser=1"
)
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 24 或更新版本。
  pause
  exit /b 1
)
node scripts\open-browser.ts --check >nul 2>nul
if not errorlevel 1 (
  echo 单词日课已在运行：http://127.0.0.1:5173/
  if not defined skip_browser node scripts\open-browser.ts
  exit /b 0
)
if not exist node_modules (
  call npm.cmd ci --no-fund
  if errorlevel 1 exit /b 1
)
call npm.cmd run build
if errorlevel 1 exit /b 1
echo.
echo 请在浏览器打开 http://127.0.0.1:5173/
echo 保持此窗口运行。按 Ctrl+C 停止。
if not defined skip_browser start "" /b node "%~dp0scripts\open-browser.ts"
call npm.cmd run preview
pause
