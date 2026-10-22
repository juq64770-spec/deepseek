# now-playing.ps1 — 读取本机当前播放状态（只读），输出一行 JSON。
# 主通道：Windows SMTC（系统媒体控件）；兜底：网易云窗口标题。
# 注意：本文件必须保存为 UTF-8 with BOM（Windows PowerShell 5.1 才能正确读中文）。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Result($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 5
  [Console]::Out.WriteLine($json)
}

$result = $null
$smtcError = ''

# PowerShell 5.1 里 WinRT 的 IAsyncOperation 没有 GetAwaiter()（那是 .NET/C# 的扩展方法），
# 需要用 System.WindowsRuntimeSystemExtensions.AsTask 包一层再等。网上很多片段用
# GetAwaiter().GetResult()，在 5.1 会报「不包含名为 GetAwaiter 的方法」。
function Await($operation, [Type]$resultType) {
  $methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  }
  if (-not $methods) { throw '找不到 AsTask(IAsyncOperation) 方法' }
  $asTask = $methods[0].MakeGenericMethod($resultType)
  $netTask = $asTask.Invoke($null, @($operation))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  # 触发 WinRT 类型投影（Windows 10 1809+）
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
} catch {
  $smtcError = "winrt-unavailable: " + $_.Exception.Message
}

if (-not $smtcError) {
  try {
    $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $sessions = @($mgr.GetSessions())
    $session = $null
    $isNetease = $false
    foreach ($s in $sessions) {
      if ([string]$s.SourceAppUserModelId -match '(?i)cloudmusic|netease') { $session = $s; $isNetease = $true; break }
    }
    if (-not $session -and $sessions.Count -gt 0) {
      $session = $mgr.GetCurrentSession()
    }
    if ($session) {
      $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $play = $session.GetPlaybackInfo()
      $timeline = $session.GetTimelineProperties()
      $result = [ordered]@{
        ok          = $true
        source      = 'smtc'
        app         = [string]$session.SourceAppUserModelId
        netease     = $isNetease
        title       = [string]$props.Title
        artist      = [string]$props.Artist
        album       = [string]$props.AlbumTitle
        status      = [string]$play.PlaybackStatus
        positionSec = [math]::Round([double]$timeline.Position.TotalSeconds, 1)
        durationSec = [math]::Round([double]$timeline.EndTime.TotalSeconds, 1)
      }
    }
  } catch {
    $smtcError = "smtc-failed: " + $_.Exception.Message
  }
}

# SMTC 没有给出“有歌名”的结果时，用网易云窗口标题兜底（拿不到进度）
if (-not $result -or [string]::IsNullOrWhiteSpace([string]$result.title)) {
  try {
    $proc = Get-Process -Name 'cloudmusic' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1
    if ($proc) {
      $titleText = [string]$proc.MainWindowTitle
      if ($titleText -and $titleText -notmatch '^网易云音乐$') {
        $result = [ordered]@{
          ok          = $true
          source      = 'window-title'
          app         = 'cloudmusic'
          netease     = $true
          title       = $titleText
          artist      = ''
          album       = ''
          status      = 'UNKNOWN'
          positionSec = $null
          durationSec = $null
        }
      }
    }
  } catch { }
}

if (-not $result) {
  $reason = 'no-session'
  if ($smtcError) { $reason = 'smtc-unavailable' }
  $out = [ordered]@{ ok = $false; reason = $reason }
  if ($smtcError) { $out.error = $smtcError }
  Write-Result $out
  exit 0
}

Write-Result $result
