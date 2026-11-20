@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-nearsend.ps1" -CreateShortcut
pause
