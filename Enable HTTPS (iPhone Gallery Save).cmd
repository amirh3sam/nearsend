@echo off
cd /d "%~dp0"
node scripts\enable-https.js
echo Restarting Nearsend...
powershell -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-nearsend.ps1"
pause
