// 本地语音转文字（Whisper）——纯函数 + 本机 whisper-cli 调用。
//
// 链路：QQ 语音段 → SnowLuma get_record(out_format=wav，服务端用自带 ffmpeg 解码 SILK)
//      → base64 WAV → 本模块转成 16kHz 单声道 PCM → whisper-cli 识别。
//
// 设计原则：
// - 全程本地：音频不离开这台电脑（微信/QQ 自带的语音转文字会把音频传给服务器，这里不用）。
// - 不猜：识别结果可能带错字，交由 AI 按语义理解；失败时明确返回 ''，调用方回退成 [语音]。
// - 可控：单条时长/字节数、每次唤醒最多转几条、每分钟次数都由配置限制，避免语音刷屏把 CPU 占满。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const STT_DEFAULT_BINARY = 'tools/whisper/Release/whisper-cli.exe';
export const STT_DEFAULT_MODEL = 'tools/whisper/models/ggml-small.bin';
export const STT_SAMPLE_RATE = 16000;

function readPcmWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) throw new Error('不是有效的 WAV 数据');
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('不是有效的 WAV 数据（缺少 RIFF/WAVE 头）');
  }
  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= buffer.length) {
      fmt = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        byteRate: buffer.readUInt32LE(body + 8),
        blockAlign: buffer.readUInt16LE(body + 12),
        bitsPerSample: buffer.readUInt16LE(body + 14)
      };
    } else if (id === 'data') {
      dataOffset = body;
      // 允许最后一个 data 块被截断（网关转码写了一半）：能读多少读多少
      dataLength = Math.max(0, Math.min(size, buffer.length - body));
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || dataOffset < 0 || dataLength <= 0) throw new Error('WAV 缺少 fmt/data 块');
  // 0xFFFE = WAVE_FORMAT_EXTENSIBLE，ffmpeg 对 >2 声道或特殊位深会用它；这里只接受 PCM 16bit。
  if (fmt.audioFormat !== 0x0001 && fmt.audioFormat !== 0xFFFE) {
    throw new Error(`不支持的 WAV 编码（format=${fmt.audioFormat}），只支持 PCM`);
  }
  if (fmt.bitsPerSample !== 16) throw new Error(`不支持的 WAV 位深（${fmt.bitsPerSample}bit），只支持 16bit PCM`);
  if (fmt.channels < 1 || fmt.channels > 8) throw new Error(`不支持的声道数（${fmt.channels}）`);
  if (fmt.sampleRate < 8000 || fmt.sampleRate > 192000) throw new Error(`不支持的采样率（${fmt.sampleRate}）`);
  return { ...fmt, dataOffset, dataLength };
}

/** 从 PCM16 WAV 里取单声道 16kHz PCM（线性插值重采样）。 */
export function wavToPcm16kMono(buffer) {
  const wav = readPcmWav(buffer);
  const frameBytes = wav.channels * 2;
  const frames = Math.floor(wav.dataLength / frameBytes);
  if (!frames) throw new Error('WAV 里没有音频样本');

  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    const base = wav.dataOffset + i * frameBytes;
    for (let c = 0; c < wav.channels; c += 1) sum += buffer.readInt16LE(base + c * 2);
    mono[i] = sum / wav.channels / 32768;
  }

  if (wav.sampleRate === STT_SAMPLE_RATE) {
    const pcm = Buffer.alloc(frames * 2);
    for (let i = 0; i < frames; i += 1) {
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mono[i] * 32768))), i * 2);
    }
    return pcm;
  }

  const outFrames = Math.max(1, Math.round((frames * STT_SAMPLE_RATE) / wav.sampleRate));
  const pcm = Buffer.alloc(outFrames * 2);
  const ratio = wav.sampleRate / STT_SAMPLE_RATE;
  for (let i = 0; i < outFrames; i += 1) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(frames - 1, i0 + 1);
    const frac = pos - i0;
    const sample = mono[i0] * (1 - frac) + mono[i1] * frac;
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * 32768))), i * 2);
  }
  return pcm;
}

/** 生成 16kHz 单声道 PCM16 WAV 文件内容。 */
export function buildWav16kMono(pcm) {  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);          // PCM
  header.writeUInt16LE(1, 22);          // mono
  header.writeUInt32LE(STT_SAMPLE_RATE, 24);
  header.writeUInt32LE(STT_SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** 不管输入是什么采样率/声道，输出 whisper 需要的 16kHz 单声道 WAV。 */
export function prepareWavForWhisper(buffer) {
  return buildWav16kMono(wavToPcm16kMono(buffer));
}

/** 读 WAV 时长（秒）。用于过滤过短的语音（几十毫秒的误触/噪音最容易让 whisper 幻觉）。 */
export function wavDurationSec(buffer) {
  const wav = readPcmWav(buffer);
  return wav.dataLength / (wav.sampleRate * wav.channels * 2);
}

/**
 * 判断一段转写是否"只有括号内容"。
 *
 * whisper 在音乐/环境音/极短音频上最常见的幻觉就是字幕声明，例如
 * "(CC字幕製作:貝爾)"、"（字幕由 Amara.org 社区提供）"。这类文本整段被括号包住、
 * 括号外没有任何正文，没有任何信息量，还可能让她对着音乐回一句莫名其妙的话，
 * 所以整条丢弃（上层退回 [语音] 占位）。
 * 只要括号外面还有正文就原样保留 —— "(真的吗) 太好啦" 是正常说话。
 */
export function isBracketedOnly(text) {
  const s = String(text ?? '').trim();
  if (!s || !/[（(【\[]/.test(s)) return false;
  const rest = s
    .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, ' ')
    .replace(/[\s，。、！？!?.,;；:：~～…—－-]+/g, '');
  return rest === '';
}

/**
 * 清理 whisper-cli 的输出：去掉时间戳行、日志行与非语音标记，拼成一行文本。
 * 用 `-nt -np` 启动时通常只剩正文，这里仍做一次防御，兼容老版本行为。
 * 整段只剩括号内容（字幕类幻觉）时返回 ''，交给调用方回退成 [语音]。
 */
export function parseWhisperText(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const kept = [];
  for (const line of lines) {
    if (/^(whisper_|system_info:|main:|ggml_|load time|fallbacks|mel time|sample time|encode time|decode time|batchd time|prompt time|total time)/i.test(line)) continue;
    const cleaned = line
      // 兼容没带 -nt 的旧版本输出：时间戳前缀去掉，正文保留
      .replace(/^\[\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}\]\s*/, '')
      .replace(/\[(BLANK_AUDIO|SILENCE|MUSIC|音乐|空白|无声)\]/gi, '')
      .replace(/[（(](音乐|music|笑声|laughter|掌声|applause)[）)]/gi, '')
      .trim();
    if (cleaned) kept.push(cleaned);
  }
  const text = kept.join(' ').replace(/\s+/g, ' ').trim();
  if (text && isBracketedOnly(text)) return '';
  return text;
}

/**
 * 转写一段 WAV（任意采样率/声道）。返回识别文本；识别不出返回 ''。
 * 抛错表示环境/调用失败（二进制缺失、超时、WAV 损坏），由调用方决定是否记日志。
 */
export async function transcribeWavBuffer(buffer, { binaryPath, modelPath, language = 'zh', threads = 4, timeoutMs = 60000 } = {}) {
  if (!binaryPath || !fs.existsSync(binaryPath)) throw new Error(`找不到 whisper 可执行文件：${binaryPath || '(未配置)'}`);
  if (!modelPath || !fs.existsSync(modelPath)) throw new Error(`找不到 whisper 模型：${modelPath || '(未配置)'}`);
  const wav = prepareWavForWhisper(buffer);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-stt-'));
  const file = path.join(dir, 'voice.wav');
  try {
    fs.writeFileSync(file, wav);
    const args = [
      '-m', modelPath,
      '-f', file,
      '-l', language,
      '-nt',                      // 不要时间戳
      '-np',                      // 不要系统信息/计时的噪音
      '-t', String(Math.max(1, Math.min(16, Number(threads) || 4)))
    ];
    return await new Promise((resolve, reject) => {
      execFile(binaryPath, args, {
        timeout: Math.max(3000, Number(timeoutMs) || 60000),
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`whisper 转写失败：${String(error.message || error).slice(0, 200)}${stderr ? `；${String(stderr).slice(0, 200)}` : ''}`));
          return;
        }
        resolve(parseWhisperText(stdout));
      });
    });
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}
