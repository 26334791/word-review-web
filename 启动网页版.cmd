@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请安装 Node.js 24 或更新版本，或使用内置 Node 的便携包。
  pause
  exit /b 1
)
if not exist node_modules (
  call npm.cmd ci --no-fund
  if errorlevel 1 exit /b 1
)
call npm.cmd run build
if errorlevel 1 exit /b 1
node scripts\serve.mjs %*
if errorlevel 1 pause
