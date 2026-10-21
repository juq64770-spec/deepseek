#requires -Version 5.1
<#
  qq-bridge 预检（由 一键启动.bat 调用）
  做四件事：
    1. 检查 config.json 是否存在
    2. 自动探测 DSH 监听端口；端口漂移时自动修正 config.json（DSH 每次重启端口会变）
    3. 检查 SnowLuma（3000/3001）；没跑就自动拉起，最多等 30 秒
    4. 校验 SnowLuma 的 HTTP/WS token 与 config.json 是否一致；不一致自动统一
  退出码：0 = 可以启动；1 = 有致命问题
#>

$ErrorActionPreference = 'Continue'
$toolsDir = $PSScriptRoot
$root = Split-Path -Parent $toolsDir
$cfgPath = Join-Path $root 'config.json'
$snowlumaHome = 'E:\SnowLuma\dist'  # 兜底；稍后优先读 config.json 里的 snowluma.homeDir
$nodeExe = ''
$foundNode = Get-Command node -ErrorAction SilentlyContinue
if ($foundNode) { $nodeExe = $foundNode.Source }
if (-not $nodeExe) {
    $portableNode = Join-Path $root '_runtime\node\node.exe'
    if (Test-Path $portableNode) { $nodeExe = $portableNode }
    elseif (Test-Path 'E:\deepseek\node.exe') { $nodeExe = 'E:\deepseek\node.exe' }
}

function Say([string]$msg, [string]$color = 'Gray') {
    Write-Host $msg -ForegroundColor $color
}

function Test-Port([int]$port, [int]$timeoutMs = 600) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne($timeoutMs)
        $connected = ($ok -and $client.Connected)
        $client.Close()
        return $connected
    } catch {
        return $false
    }
}

function Save-Json($obj, [string]$path) {
    $json = $obj | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

Say ''
Say '======== qq-bridge 预检 ========' 'Cyan'
Say ''

if (-not (Test-Path $cfgPath)) {
    Say '  XX  找不到 config.json' 'Red'
    Say '      先复制 config.example.json 为 config.json 并填好字段' 'Yellow'
    exit 1
}
$cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($cfg.snowluma.homeDir) { $snowlumaHome = $cfg.snowluma.homeDir }
elseif ($cfg.snowluma.launcherPath) { $snowlumaHome = Join-Path $cfg.snowluma.launcherPath 'dist' }
Say '  OK  config.json' 'Green'

$fatal = $false

# ---------- DSH ----------
$dshProcs = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
if (-not $dshProcs) {
    Say '  XX  DeepSeek Harness 没在运行（它是大脑）' 'Red'
    Say '      先打开 DeepSeek Harness，再跑本脚本' 'Yellow'
    $fatal = $true
} else {
    $dshPorts = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.OwningProcess -in $dshProcs.Id } |
        Select-Object -ExpandProperty LocalPort -Unique)

    if ($dshPorts.Count -eq 0) {
        Say '  XX  DSH 进程在，但没监听端口（可能还在启动，稍等再试）' 'Red'
        $fatal = $true
    } else {
        $port = ($dshPorts | Sort-Object)[0]
        $want = "http://127.0.0.1:$port"
        if ($cfg.dsh.baseUrl -ne $want) {
            Say "  !!  DSH 端口变了：$($cfg.dsh.baseUrl)  ->  $want" 'Yellow'
            Say '      自动修正 config.json ...' 'Yellow'
            $cfg.dsh.baseUrl = $want
            Save-Json $cfg $cfgPath
            Say '      OK  已写回' 'Green'
        }
        Say "  OK  DSH（$want）" 'Green'
    }
}

# ---------- SnowLuma ----------
$httpOpen = Test-Port 3000
$wsOpen = Test-Port 3001

if ($httpOpen -and $wsOpen) {
    Say '  OK  SnowLuma（HTTP 3000 / WS 3001）' 'Green'
} elseif ($httpOpen -or $wsOpen) {
    Say '  !!  SnowLuma 只开了一半（3000/3001 有一个没监听）' 'Yellow'
    $fatal = $true
} else {
    Say '  ..  SnowLuma 没在跑，尝试自动启动 ...' 'Yellow'
    $indexMjs = Join-Path $snowlumaHome 'index.mjs'
    if (-not (Test-Path $indexMjs)) {
        Say "  XX  找不到 $indexMjs" 'Red'
        $fatal = $true
    } elseif (-not (Test-Path $nodeExe)) {
        Say "  XX  找不到 Node：$nodeExe" 'Red'
        $fatal = $true
    } else {
        Start-Process -FilePath $nodeExe -ArgumentList './index.mjs' -WorkingDirectory $snowlumaHome -WindowStyle Hidden
        $ok = $false
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Milliseconds 1000
            if ((Test-Port 3000) -and (Test-Port 3001)) { $ok = $true; break }
        }
        if ($ok) {
            Say '  OK  SnowLuma 已自动启动（HTTP 3000 / WS 3001）' 'Green'
        } else {
            Say '  XX  SnowLuma 启动超时（30 秒内未监听端口）' 'Red'
            Say '      手动看报错：cd E:\SnowLuma\dist 然后 node ./index.mjs' 'Yellow'
            $fatal = $true
        }
    }
}

# ---------- token 一致性 ----------
if ($fatal -eq $false) {
    $cfgDir = Join-Path $snowlumaHome 'config'
    $onebotFiles = @(Get-ChildItem $cfgDir -Filter 'onebot_*.json' -ErrorAction SilentlyContinue)
    if ($onebotFiles.Count -gt 0) {
        $obPath = $onebotFiles[0].FullName
        $ob = Get-Content $obPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $httpToken = $ob.networks.httpServers[0].accessToken
        $wsToken = $ob.networks.wsServers[0].accessToken
        $cfgToken = $cfg.snowluma.accessToken

        if ($httpToken -ne $wsToken) {
            Say '  !!  SnowLuma 的 HTTP 与 WS token 不一致（MCP 会 401）' 'Yellow'
            Say '      自动统一为 HTTP token，需重启 SnowLuma 生效 ...' 'Yellow'
            $ob.networks.wsServers[0].accessToken = $httpToken
            Save-Json $ob $obPath
            Say '      OK  已写回 SnowLuma 配置' 'Green'
        }
        if ($cfgToken -ne $httpToken) {
            Say '  !!  config.json 的 accessToken 与 SnowLuma 不一致' 'Yellow'
            Say '      自动同步 ...' 'Yellow'
            $cfg.snowluma.accessToken = $httpToken
            Save-Json $cfg $cfgPath
            Say '      OK  已写回 config.json' 'Green'
        }
        if ($httpToken -eq $wsToken -and $cfgToken -eq $httpToken) {
            Say '  OK  token 三处一致' 'Green'
        }
    }
}

Say ''
if ($fatal) {
    Say '  预检未通过 —— 先解决上面标 XX 的项' 'Red'
    exit 1
}
Say '  预检通过，可以启动' 'Green'
exit 0