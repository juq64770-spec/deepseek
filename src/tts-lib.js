// 本地 TTS（edge-tts）：文字 → 语音文件。
//
// 为什么用 edge-tts（而不是本机 SAPI / Piper）：
//   微软神经语音，音色自然度远高于 Windows 自带 SAPI，且 Python 侧零编译安装
//   （pip install edge-tts，一条命令）。代价是需要联网（经可选 proxy）——
//   上传的只是「她自己要说的话」，不含用户隐私；语音**转文字**那半边仍然全程本地。
//
// 输出格式：mp3（24kHz / 48kbps / 单声道）。SnowLuma 收 record 文件后自己转 SILK，
// 所以桥接侧不需要 ffmpeg 参与（本机没有 ffmpeg CLI 也不影响这条链路）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** 默认音色：晓伊（活泼，卡通向）—— 贴近「小鲸鱼」人设。 */
export const TTS_DEFAULT_VOICE = 'zh-CN-XiaoyiNeural';
/** 已确认可用的中文女声（供配置校验 / CLI 提示）。 */
export const TTS_KNOWN_VOICES = [
  'zh-CN-XiaoyiNeural',
  'zh-CN-XiaoxiaoNeural',
  'zh-CN-liaoning-XiaobeiNeural',
  'zh-CN-shaanxi-XiaoniNeural'
];
/** 默认语速 / 音量 / 音调（edge-tts 语法：rate/volume 为 +N% / -N%，pitch 为 +NHz / -NHz）。 */
export const TTS_DEFAULT_RATE = '+0%';
export const TTS_DEFAULT_VOLUME = '+0%';
export const TTS_DEFAULT_PITCH = '+0Hz';
/** 语音条默认字数上限：QQ 语音约 4~5 字/秒，200 字 ≈ 45 秒，贴近单条语音的舒适长度。 */
export const TTS_MAX_CHARS = 200;

/**
 * 清洗要合成的文本：
 *   - 去掉 CQ 码（[CQ:xxx] 会原样念出来）
 *   - 去掉 markdown 强调符号（* _ ~ ` > #），念出来很奇怪
 *   - 换行/连续空白并成单个空格（TTS 没有"分段"概念）
 *   - 截断到 maxChars（截断要在去掉 markdown 之后，避免上限被符号吃掉）
 */
export function sanitizeTtsText(raw, maxChars = TTS_MAX_CHARS) {
  let t = String(raw ?? '').trim();
  t = t.replace(/\[CQ:[^\]]*\]/g, ' ');
  t = t.replace(/[*_~`>#]/g, '');
  t = t.replace(/\s+/g, ' ');
  t = t.trim();
  if (t.length > maxChars) t = t.slice(0, maxChars).trimEnd();
  return t;
}

/** 校验语音配置项，非法时抛出可读错误（桥接端点在合成前调用）。 */
export function validateTtsOptions({ voice = TTS_DEFAULT_VOICE, rate = TTS_DEFAULT_RATE, volume = TTS_DEFAULT_VOLUME, pitch = TTS_DEFAULT_PITCH, edgeTtsCmd = 'edge-tts' } = {}) {
  if (typeof voice !== 'string' || !voice.trim()) throw new Error('TTS 音色不能为空');
  if (typeof edgeTtsCmd !== 'string' || !edgeTtsCmd.trim()) throw new Error('edge-tts 命令不能为空');
  for (const [label, val] of [['语速', rate], ['音量', volume]]) {
    if (typeof val !== 'string' || !/^[+-]\d{1,3}%$/.test(val.trim())) {
      throw new Error(`TTS ${label}格式应为 +N% 或 -N%（如 +0% / +10% / -20%），收到「${val}」`);
    }
  }
  if (typeof pitch !== 'string' || !/^[+-]\d{1,3}Hz$/.test(pitch.trim())) {
    throw new Error(`TTS 音调格式应为 +NHz 或 -NHz（如 +0Hz / +25Hz / -25Hz），收到「${pitch}」`);
  }
  return { voice: voice.trim(), rate: rate.trim(), volume: volume.trim(), pitch: pitch.trim(), edgeTtsCmd: edgeTtsCmd.trim() };
}

/**
 * 合成一段语音到临时 mp3 文件。
 *
 * @param {string} text 要说的文字（会被 sanitizeTtsText 清洗）
 * @param {object} opts
 *   voice      音色（默认 TTS_DEFAULT_VOICE）
 *   rate       语速 +N%/-N%（默认 +0%）
 *   volume     音量 +N%/-N%（默认 +0%）
 *   edgeTtsCmd edge-tts 命令名或完整路径
 *   proxy      可选代理（如 http://127.0.0.1:7897，本机直连 Bing 不通时用）
 *   tmpDir     输出目录（默认系统临时目录 qq-tts-speak）
 *   timeoutMs  合成超时（默认 60s）
 * @returns {Promise<{ path, bytes, text, voice }>} 调用方负责用完删除 path 指向的临时文件
 */
export async function synthesizeTextToFile(text, opts = {}) {
  const cfg = validateTtsOptions(opts);
  const clean = sanitizeTtsText(text);
  if (!clean) throw new Error('要说的内容为空');

  const dir = opts.tmpDir ? path.resolve(opts.tmpDir) : path.join(os.tmpdir(), 'qq-tts-speak');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    throw new Error(`TTS 临时目录不可用（${dir}）：${error?.message ?? error}`);
  }
  const outFile = path.join(dir, `speak-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
  // 参数一律用 `--key=value` 形式：edge-tts 的 argparse 会把 `-20%` / `-25Hz` 这类
  // 以负号开头的裸值当成未知选项吞掉（合成直接失败），等号写法没有这个问题。
  const args = ['--voice', cfg.voice, `--rate=${cfg.rate}`, `--volume=${cfg.volume}`, `--pitch=${cfg.pitch}`, '--text', clean, '--write-media', outFile];
  if (opts.proxy) args.unshift(`--proxy=${String(opts.proxy)}`);

  let stderr = '';
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 60000;
  const run = () => new Promise((resolve) => {
    let child;
    try {
      child = spawn(cfg.edgeTtsCmd, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      resolve({ code: -1, error: `edge-tts 启动失败：${error?.message ?? error}` });
      return;
    }
    const timer = setTimeout(() => { try { child.kill(); } catch {} resolve({ code: -2, error: 'edge-tts 合成超时' }); }, timeoutMs);
    child.stderr.on('data', (c) => {
      // 只保留末尾一段，防止错误输出失控
      if (stderr.length < 4000) stderr += String(c);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, error: e.code === 'ENOENT' ? '找不到 edge-tts（请 pip install edge-tts，或在 config 里指定 socialV2.tts.edgeTtsCmd）' : `edge-tts 不可用：${e.message}` });
    });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code }); });
  });

  const res = await run();
  if (res.error) {
    try { fs.unlinkSync(outFile); } catch {}
    throw new Error(res.error);
  }
  let st = null;
  try { st = fs.statSync(outFile); } catch {}
  if (res.code !== 0 || !st || st.size === 0) {
    try { fs.unlinkSync(outFile); } catch {}
    const tail = stderr.trim().split(/\r?\n/).slice(-3).join(' | ');
    throw new Error(`edge-tts 合成失败（退出码 ${res.code}）${tail ? `：${tail}` : ''}`);
  }
  return { path: outFile, bytes: st.size, text: clean, voice: cfg.voice };
}

/** 删除合成临时文件（失败不抛）。 */
export function cleanupTtsTemp(file) {
  if (!file) return;
  try { fs.unlinkSync(file); } catch {}
}
