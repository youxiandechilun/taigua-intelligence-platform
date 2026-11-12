@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo 首次运行，正在安装依赖...
  call npm install --no-audit --no-fund
)
echo.
echo   WhatsApp 扫码控制台启动中...
echo   浏览器打开: http://127.0.0.1:8100
echo.
node server.js
pause
