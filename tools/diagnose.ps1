#requires -Version 5.1
<#
  qq-bridge 诊断（由 诊断.bat 调用）
  一次性打印所有关键状态，快速定位"为什么不回消息"
#>

$ErrorActionPreference = 'Continue'
$toolsDir = $PSScriptRoot
$root = Split-Path -Parent $toolsDir
$cfgPath = Join-Path $root 'config.json'
$logPath = Join-Path $root 'state\bridge.log'
$snowlumaHome = 'E:\SnowLuma\dist'  # 兜底；稍后优先读 config.json 里的 snowluma.homeDir

function Say([string]$msg, [string]$color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Rule([string]$title) {
    Say ''
    Say "---------- $title ----------" 'Cyan'
}

function Test-Port([int]$port, [int]$timeoutMs = 500) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne($timeoutMs)
        $connected = ($ok -and $client.Connected)
        $client.Close()
        return $connected
    } catch { return $false }
}

function Get-PortOwner([int]$port) {
    $c = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq $port }
    if ($c) { return ($c | Select-Object -First 1).OwningProcess }
    return 0
}

Say ''
Say '======== qq-bridge 诊断报告 ========' 'Cyan'
Say ("时间: " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))

# ---------- 一层：进程（以端口反查为准） ----------
Rule '一层：进程'
$dshProcs = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
if ($dshProcs) { Say ("  DSH         进程 " + $dshProcs.Count + " 个") 'Green' }
else { Say '  DSH         没运行' 'Red' }

$brPid = Get-PortOwner 3100
$slPid = Get-PortOwner 3000

if ($brPid -gt 0) { Say ("  qq-bridge   PID " + $brPid + "（3100 在监听）") 'Green' }
else { Say '  qq-bridge   没运行（所以 QQ 上不回消息）' 'Red' }

if ($slPid -gt 0) { Say ("  SnowLuma    PID " + $slPid + "（3000 在监听）") 'Green' }
else { Say '  SnowLuma    没运行' 'Red' }

# 补充：命令行带绝对路径的启动方式也能识别
$nodeProcs = Get-Process -Name node -ErrorAction SilentlyContinue
$extraSl = @()
foreach ($p in $nodeProcs) {
    $cmd = (Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.Id) -ErrorAction SilentlyContinue).CommandLine
    if ($cmd -match 'SnowLuma' -and $p.Id -ne $slPid) { $extraSl += $p.Id }
}
if ($extraSl.Count -gt 0) { Say ("  （另有 SnowLuma 相关进程: " + ($extraSl -join ',') + "）") 'DarkGray' }

# ---------- 二层：端口 ----------
Rule '二层：端口'
$checks = @(
    @{ Port = 3000; Name = 'SnowLuma HTTP   ' },
    @{ Port = 3001; Name = 'SnowLuma WS     ' },
    @{ Port = 3100; Name = 'bridge 控制台   ' },
    @{ Port = 5099; Name = 'SnowLuma WebUI  ' }
)
foreach ($c in $checks) {
    if (Test-Port $c.Port) { Say ("  OK  " + $c.Name + $c.Port) 'Green' }
    else { Say ("  XX  " + $c.Name + $c.Port + " 未监听") 'Red' }
}

$dshPort = 0
if ($dshProcs) {
    $ports = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.OwningProcess -in $dshProcs.Id } |
        Select-Object -ExpandProperty LocalPort -Unique)
    if ($ports.Count -gt 0) {
        $dshPort = ($ports | Sort-Object)[0]
        Say ("  OK  DSH API       " + $dshPort) 'Green'
    } else { Say '  XX  DSH API       未监听' 'Red' }
}

# ---------- 三层：配置 ----------
Rule '三层：配置'
if (-not (Test-Path $cfgPath)) {
    Say '  XX  找不到 config.json' 'Red'
} else {
    $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($cfg.snowluma.homeDir) { $snowlumaHome = $cfg.snowluma.homeDir }
    elseif ($cfg.snowluma.launcherPath) { $snowlumaHome = Join-Path $cfg.snowluma.launcherPath 'dist' }
    Say ("  ownerQQ          " + $cfg.ownerQQ)
    Say ("  allow.private    " + (($cfg.allow.private) -join ', '))
    Say ("  dsh.baseUrl      " + $cfg.dsh.baseUrl)
    if ($dshPort -gt 0) {
        $want = "http://127.0.0.1:$dshPort"
        if ($cfg.dsh.baseUrl -ne $want) {
            Say ("  !!  DSH 端口漂移，应为 " + $want + "（用 一键启动.bat 会自动修正）") 'Yellow'
        } else {
            Say '  OK  dsh.baseUrl 与实际端口一致' 'Green'
        }
    }

    $cfgDir = Join-Path $snowlumaHome 'config'
    $onebotFiles = @(Get-ChildItem $cfgDir -Filter 'onebot_*.json' -ErrorAction SilentlyContinue)
    if ($onebotFiles.Count -gt 0) {
        $ob = Get-Content $onebotFiles[0].FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        $httpToken = $ob.networks.httpServers[0].accessToken
        $wsToken = $ob.networks.wsServers[0].accessToken
        if ($httpToken -eq $wsToken -and $cfg.snowluma.accessToken -eq $httpToken) {
            Say '  OK  token 三处一致' 'Green'
        } else {
            Say '  !!  token 不一致（HTTP/WS/config 三处需相同）' 'Yellow'
            Say ('      HTTP  : ' + $httpToken)
            Say ('      WS    : ' + $wsToken)
            Say ('      config: ' + $cfg.snowluma.accessToken)
        }
    }
}

# ---------- 四层：DSH preset ----------
Rule '四层：DSH preset（qq-chat-v2 缺失会拒绝建会话）'
$desktopPkg = Join-Path $env:USERPROFILE '.dsh\profiles\desktop\package.json'
$desktopPatch = Join-Path $env:USERPROFILE '.dsh\profiles\desktop\cordis.patch.yml'
if (Test-Path $desktopPkg) {
    $pkg = Get-Content $desktopPkg -Raw -Encoding UTF8 | ConvertFrom-Json
    $bundles = @($pkg.dsh.profile.bundles)
    if ($bundles -contains 'qq-agent-presets') {
        Say '  OK  desktop profile 已注册 qq-agent-presets' 'Green'
    } else {
        Say '  !!  desktop profile 缺 qq-agent-presets（跑 node scripts\setup-dsh.mjs desktop）' 'Yellow'
    }
}
if (Test-Path $desktopPatch) {
    if ((Get-Content $desktopPatch -Raw -Encoding UTF8) -match 'mcp-snowluma') {
        Say '  OK  cordis.patch.yml 已挂载 mcp-snowluma' 'Green'
    } else {
        Say '  !!  cordis.patch.yml 缺 mcp-snowluma 条目' 'Yellow'
    }
}

# ---------- 五层：日志 ----------
Rule '五层：日志（最近 30 行，错误标黄）'
if (Test-Path $logPath) {
    Get-Content $logPath -Tail 30 -Encoding UTF8 | ForEach-Object {
        if ($_ -match '错误|失败|ERROR|WARN|fatal|拒绝|超时|401|403|ECONN|未设置唤醒') {
            Write-Host $_ -ForegroundColor Yellow
        } else {
            Write-Host $_ -ForegroundColor DarkGray
        }
    }
} else {
    Say '  （还没有 state\bridge.log，说明桥接从没成功启动过）' 'Yellow'
}

Say ''
Say '======== 报告结束 ========' 'Cyan'
Say '提示：' 'Cyan'
Say '  · 任何一项 XX 都要先修好' 'Gray'
Say '  · DSH 端口漂移 / token 不一致，用 一键启动.bat 会自动修' 'Gray'
Say '  · 启动顺序：DSH（手动开）→ 其余自动' 'Gray'
Say ''