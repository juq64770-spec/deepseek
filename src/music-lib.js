// 「听歌」——读取本机当前播放状态（只读，不上传任何内容）。
//
// 主通道：Windows SMTC（GlobalSystemMediaTransportControlsSessionManager）。
//   网易云音乐 PC 版会把播放状态交给系统媒体控件，因此能拿到歌名/歌手/专辑/
//   播放状态/进度，不需要登录、不需要读它的私有数据。
// 兜底：读取网易云窗口标题（格式通常是「歌名 - 歌手」）。
//   有些老版本/被精简的客户端不接 SMTC，窗口标题仍然可用；但拿不到进度。
//
// 本机实测不了的场景（没装网易云）由调用方按 ok:false 处理，不要猜歌名。

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const NOW_PLAYING_SCRIPT = path.resolve(__dirname, '..', 'tools', 'now-playing.ps1');

const PLAYING_STATUSES = new Set(['PLAYING', 'PAUSED', 'STOPPED', 'CLOSED', 'CHANGING', 'OPENED']);

function round1(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null;
}

/** 从 PowerShell 输出里取最后一个 JSON 对象（容忍前面的警告/横幅行）。 */
export function parseNowPlayingOutput(text) {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('播放状态读取器没有输出');
  const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith('{')) continue;
    try {
      return JSON.parse(line);
    } catch {
      // 继续往前找：PowerShell 偶尔会在 JSON 前后夹杂提示
    }
  }
  throw new Error(`播放状态读取器输出不是 JSON：${raw.slice(0, 160)}`);
}

/**
 * 把读取器原始输出归一化成工具返回值。
 * - ok:false 原样带回 reason（no-session / smtc-unavailable）
 * - 标题为空时视为没有在播（有些播放器暂停后会保留空会话）
 */
export function normalizeNowPlaying(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  if (data.ok !== true) {
    return { ok: false, reason: String(data.reason || 'unavailable'), error: data.error ? String(data.error) : '' };
  }
  const title = String(data.title ?? '').trim();
  const artist = String(data.artist ?? '').trim();
  if (!title || /^网易云音乐$/.test(title)) {
    return { ok: false, reason: 'no-title' };
  }
  const statusRaw = String(data.status ?? '').trim().toUpperCase();
  return {
    ok: true,
    source: String(data.source || 'smtc'),
    app: String(data.app || ''),
    netease: data.netease === true,
    title,
    artist,
    album: String(data.album ?? '').trim(),
    status: PLAYING_STATUSES.has(statusRaw) ? statusRaw : (statusRaw || 'UNKNOWN'),
    positionSec: round1(data.positionSec),
    durationSec: round1(data.durationSec)
  };
}

/**
 * 兜底的窗口标题解析：网易云主窗口标题一般是「歌名 - 歌手」。
 * 用最后一个「 - 」切分，避免歌名自身带「-」时把歌手切丢。
 * @returns {title, artist} 或 null（窗口只是「网易云音乐」/空标题）
 */
export function parseWindowTitle(rawTitle) {
  let text = String(rawTitle ?? '').trim();
  if (!text) return null;
  // 某些版本会带客户端后缀
  text = text.replace(/\s*[-–—]\s*网易云音乐\s*$/, '').trim();
  if (!text || /^网易云音乐$/.test(text)) return null;
  const idx = text.lastIndexOf(' - ');
  if (idx > 0) {
    const title = text.slice(0, idx).trim();
    const artist = text.slice(idx + 3).trim();
    if (title) return { title, artist };
  }
  return { title: text, artist: '' };
}

/** 把窗口标题兜底结果归一化成与 SMTC 相同的返回形状。 */
export function normalizeWindowFallback(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const parsed = parseWindowTitle(data.title);
  if (!parsed) return { ok: false, reason: 'no-title' };
  return {
    ok: true,
    source: 'window-title',
    app: String(data.app || 'cloudmusic'),
    netease: true,
    title: parsed.title,
    artist: parsed.artist,
    album: '',
    status: 'UNKNOWN',
    positionSec: null,
    durationSec: null
  };
}

/**
 * 调 PowerShell 读取器。没有播放会话时返回 {ok:false, reason}，不抛错。
 * @param options.timeoutMs 超时（默认 8 秒；首次 WinRT 初始化可能慢一点）
 * @param options.powershell PowerShell 可执行文件（默认 powershell.exe，5.1 才有 WinRT 投影）
 * @param options.scriptPath 读取器脚本路径（测试可替换）
 */
export function readNowPlaying({ timeoutMs = 8000, powershell = 'powershell.exe', scriptPath = NOW_PLAYING_SCRIPT } = {}) {
  return new Promise((resolve) => {
    execFile(
      powershell,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { timeout: Math.max(1000, Number(timeoutMs) || 8000), windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          // 超时/被杀/脚本不存在：都按“暂时读不到”处理，不把 stderr 噪音抛给模型
          resolve({ ok: false, reason: 'reader-failed', error: String(error?.message ?? error).slice(0, 200) });
          return;
        }
        try {
          const raw = parseNowPlayingOutput(stdout);
          // 窗口标题兜底的结果是整串「歌名 - 歌手」，需要在这里再拆一次；
          // SMTC 的结果已经是分字段的。
          resolve(raw.source === 'window-title' ? normalizeWindowFallback(raw) : normalizeNowPlaying(raw));
        } catch (parseError) {
          resolve({ ok: false, reason: 'reader-invalid', error: String(parseError?.message ?? parseError).slice(0, 200) });
        }
      }
    );
  });
}
