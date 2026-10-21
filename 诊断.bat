@echo off
chcp 936 >nul
setlocal
title qq-bridge ’Ô∂œ
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\diagnose.ps1"

echo.
pause
endlocal