@echo off
chcp 936 >nul
setlocal
title qq-bridge 一键启动（这个窗口不要关）
cd /d "%~dp0"

echo.
echo  ==================================================
echo                qq-bridge 一键启动（别关）
echo  ==================================================
echo.

if not exist "config.json" (
    echo  XX 没填好 config.json
    echo     先按 config.example.json 复制成 config.json 再填好
    pause
    exit /b 1
)

echo  运行预检（自动修 DSH 端口 / 自动拉起 SnowLuma / 对齐 token）...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\preflight.ps1"
if errorlevel 1 (
    echo.
    echo  预检没通过，先解决上面标 XX 的问题
    echo  请打开诊断状态：双击 诊断.bat
    pause
    exit /b 1
)

echo.
echo  --------------------------------------------------
echo  正在启动，接下来会刷屏刷日志
echo.
echo   * 这个窗口不要关，最小化它 *
echo   或者：直接关闭本窗口即可下线
echo  --------------------------------------------------
echo.

chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
    if exist "%~dp0_runtime\node\node.exe" set "PATH=%~dp0_runtime\node;%PATH%"
)
node src\bridge.js
chcp 936 >nul

echo.
echo  bridge 已退出
echo  异常退出的话双击 看日志.bat 或 诊断.bat 看全貌
pause
endlocal
