@echo off
chcp 936 >nul
setlocal
title qq-bridge 实时日志（Ctrl+C 停止，窗口可关）
cd /d "%~dp0"

echo.
echo  正在实时跟踪 state\bridge.log
echo  先显示最近 80 行，之后新行自动滚出来
echo  （Ctrl+C 停止跟踪；关掉这个窗口不影响 bridge 运行）
echo.

chcp 65001 >nul
powershell -NoProfile -Command "Get-Content -Path 'state\bridge.log' -Tail 80 -Wait -Encoding UTF8"
chcp 936 >nul

echo.
echo  跟踪已停止。
pause
endlocal