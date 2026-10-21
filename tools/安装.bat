@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
title 小鲸鱼 · 一键安装

rem ════════════════════════════════════════════════════════════════
rem  小鲸鱼安装器 —— 下载 qq-bridge、装依赖、生成配置、复制自研脚本
rem  只做这几件事：不碰注册表、不动你系统里已有的文件
rem  仓库：github.com/juq64770-spec/deepseek
rem ════════════════════════════════════════════════════════════════

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║              小鲸鱼 · 一键安装（qq-bridge）           ║
echo  ╚══════════════════════════════════════════════════════╝
echo.

rem ── 选安装目录 ──────────────────────────────────────────────────
set "TARGET=%~1"
if "%TARGET%"=="" (
    echo  装到哪个文件夹？
    echo  （直接回车 = D:\qq-bridge，推荐）
    echo.
    set /p TARGET= 路径：
)
if "%TARGET%"=="" set "TARGET=D:\qq-bridge"

echo.
echo  将安装到：!TARGET!
echo.

rem ── [1/6] 检查 Node.js ──────────────────────────────────────────
echo  [1/6] 检查 Node.js...
where node >nul 2>nul
if errorlevel 1 goto :node_missing
goto :check_npm

:node_missing
echo.
echo        系统里没找到 Node.js。
echo        我可以帮你下个便携版（约 30MB，只放在安装目录里，
echo        不写注册表、不改系统设置）。
choice /c YN /m "        自动下载便携版"
if errorlevel 2 goto :node_manual

if not exist "%~dp0install-node.ps1" (
    echo.
    echo  !! 安装包里没有 install-node.ps1（安装包不完整）
    echo     请重新下载完整的 tools 文件夹后再跑
    goto :node_manual
)
echo        下载中（约 30MB），可能要几分钟，请耐心...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-node.ps1" -Dest "!TARGET!\_runtime\node"
if errorlevel 1 goto :node_manual
set "PATH=!TARGET!\_runtime\node;%PATH%"
echo        便携版 Node 已就位（本次安装用）
goto :check_npm

:node_manual
echo.
echo  需要你自己装 Node.js：
echo    1. 浏览器搜 "Node.js 官网"
echo    2. 下载 LTS 版本（左边那个按钮）
echo    3. 双击安装，一路"下一步"
echo    4. 装完重启电脑，再回来双击本安装脚本
echo.
pause
exit /b 1

:check_npm
where npm >nul 2>nul
if errorlevel 1 (
    echo  !! 有 node 但没找到 npm，建议卸载后重装 Node
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
echo        OK  Node.js !NODEV!

rem ── [2/6] 下载 qq-bridge ────────────────────────────────────────
echo.
echo  [2/6] 下载 qq-bridge...

if exist "!TARGET!\src\bridge.js" (
    echo        已经装过了，跳过下载
    goto :skip_download
)

if exist "!TARGET!" (
    echo  !! 目标目录已存在，但里面不是 qq-bridge
    echo     换个目录，或者先把那个目录删掉
    pause
    exit /b 1
)

mkdir "!TARGET!" 2>nul
set "ZIP=%TEMP%\qq-bridge-%RANDOM%.zip"
set "URL=https://gh-proxy.com/https://github.com/juq64770-spec/deepseek/archive/refs/heads/main.zip"

echo        下载中（可能要一两分钟）...
powershell -NoProfile -Command ^
  "try { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest '%URL%' -OutFile '%ZIP%' -UseBasicParsing -TimeoutSec 300; Write-Host '        OK 下载完成' } catch { Write-Host ('        X 第一次下载失败：' + $_.Exception.Message); exit 1 }"
if errorlevel 1 (
    echo        换直连源重试...
    set "URL=https://github.com/juq64770-spec/deepseek/archive/refs/heads/main.zip"
    powershell -NoProfile -Command ^
      "try { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest '%URL%' -OutFile '%ZIP%' -UseBasicParsing -TimeoutSec 300; Write-Host '        OK 直连下载完成' } catch { Write-Host ('        X 直连也失败：' + $_.Exception.Message); exit 1 }"
)
if errorlevel 1 (
    echo.
    echo  !! 下载失败（网络问题）
    echo     手动办法：
    echo      1. 浏览器打开 gh-proxy.com/https://github.com/juq64770-spec/deepseek
    echo      2. 绿色 Code 按钮 - Download ZIP
    echo      3. 解压到 !TARGET!
    echo      4. 重新双击本安装脚本（它会自动跳过下载）
    echo.
    pause
    exit /b 1
)

echo        解压中...
powershell -NoProfile -Command ^
  "Expand-Archive -Path '%ZIP%' -DestinationPath '%TEMP%\qqb-tmp' -Force; $d = Get-ChildItem '%TEMP%\qqb-tmp' -Directory | Select-Object -First 1; Copy-Item ($d.FullName + '\*') '!TARGET!' -Recurse -Force"
if errorlevel 1 (
    echo  !! 解压失败
    pause
    exit /b 1
)
del "%ZIP%" >nul 2>nul
rmdir /s /q "%TEMP%\qqb-tmp" >nul 2>nul
echo        OK 解压完成

:skip_download

rem ── [3/6] 装依赖（npm install） ─────────────────────────────────
echo.
echo  [3/6] 安装依赖（npm install，第一次要三五分钟，别关）...
echo.
pushd "!TARGET!"
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo  !! npm install 报错了，多半是网络问题
    choice /c YN /m "        换成国内镜像重试"
    if !errorlevel!==1 (
        call npm install --no-audit --no-fund --registry=https://registry.npmmirror.com
    )
)
popd
echo        OK 依赖装完

rem ── [4/6] 复制自研脚本 ──────────────────────────────────────────
echo.
echo  [4/6] 复制自研脚本（一键启动/诊断/看日志）...

set "MISSING="
if exist "%~dp0..\一键启动.bat" (
    copy /y "%~dp0..\一键启动.bat" "!TARGET!\" >nul
    copy /y "%~dp0..\诊断.bat" "!TARGET!\" >nul
    copy /y "%~dp0..\看日志.bat" "!TARGET!\" >nul
    echo        OK 一键启动/诊断/看日志 已就位
) else set "MISSING=1"

if exist "%~dp0preflight.ps1" (
    if not exist "!TARGET!\tools" mkdir "!TARGET!\tools"
    copy /y "%~dp0preflight.ps1" "!TARGET!\tools\" >nul
    copy /y "%~dp0diagnose.ps1" "!TARGET!\tools\" >nul
    echo        OK 预检/诊断脚本 已就位
) else set "MISSING=1"

if defined MISSING (
    echo        .. 没找到自研脚本（安装包不完整）。
    echo           不影响桥接本体：以后用 npm start 也能跑。
)

rem ── [5/6] 生成配置文件 ──────────────────────────────────────────
echo.
echo  [5/6] 生成配置文件...
if exist "!TARGET!\config.json" (
    echo        已有 config.json，跳过
    goto :skip_config
)
if not exist "!TARGET!\config.example.json" (
    echo  !! 没找到 config.example.json（下载可能不完整）
    goto :skip_config
)
copy "!TARGET!\config.example.json" "!TARGET!\config.json" >nul
echo        OK 已生成 config.json

:skip_config

rem ── [6/6] 打开记事本填三个值 ────────────────────────────────────
echo.
echo  [6/6] 请填三个值（记事本里）：
echo.
echo   ┌────────────────────────────────────────────┐
echo   │  ownerQQ           改成 你自己的 QQ 号       │
echo   │  allow.private     把其中一个数换成对方的号  │
echo   │  snowluma.accessToken
echo   │                    从 SnowLuma 界面里复制    │
echo   └────────────────────────────────────────────┘
echo.
echo   另外：如果 SnowLuma 不在 E:\SnowLuma\dist，
echo   把 snowluma.launcherPath / homeDir 改成实际路径。
echo.
pause
start notepad "!TARGET!\config.json"

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║                     装完了                          ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
echo   装到了：!TARGET!
echo.
echo   接下来：
echo    · 确认 SnowLuma 已经扫码登录（那个窗口别关）
echo    · 确认 DeepSeek Harness 已经打开
echo    · 双击 !TARGET!\一键启动.bat
echo      （没自研脚本就用：cd /d !TARGET! 然后 npm start）
echo.
echo   出问题先双击 诊断.bat，看哪一层是红的。
echo.
pause
endlocal
