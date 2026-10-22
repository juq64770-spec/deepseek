// 语音转文字纯函数测试：只测 WAV 归一化与 whisper 输出解析，不调用真实 QQ。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildWav16kMono,
  isBracketedOnly,
  parseWhisperText,
  prepareWavForWhisper,
  wavDurationSec,
  wavToPcm16kMono
} from '../src/stt-lib.js';

// 造一段 PCM16 WAV（可指定采样率/声道数），用来验证重采样。
function makeWav({ sampleRate = 24000, channels = 1, frames = 2400, fill = 1000 } = {}) {
  const data = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames * channels; i += 1) data.writeInt16LE(fill, i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test('prepareWavForWhisper：24k 单声道 → 16k 单声道，时长不变', () => {
  // 1 秒 24kHz = 24000 帧 → 16kHz 应为 16000 帧
  const out = prepareWavForWhisper(makeWav({ sampleRate: 24000, channels: 1, frames: 24000 }));
  assert.equal(out.toString('ascii', 0, 4), 'RIFF');
  assert.equal(out.readUInt16LE(22), 1);              // 单声道
  assert.equal(out.readUInt32LE(24), 16000);          // 16kHz
  assert.equal(out.readUInt16LE(34), 16);             // 16bit
  assert.equal(out.readUInt32LE(40), 16000 * 2);      // data 长度 = 16000 帧
});

test('prepareWavForWhisper：立体声混成单声道', () => {
  const out = prepareWavForWhisper(makeWav({ sampleRate: 16000, channels: 2, frames: 8000 }));
  assert.equal(out.readUInt16LE(22), 1);
  assert.equal(out.readUInt32LE(24), 16000);
  assert.equal(out.readUInt32LE(40), 8000 * 2);
});

test('wavToPcm16kMono：已是 16k 单声道时样本保持不变', () => {
  const src = makeWav({ sampleRate: 16000, channels: 1, frames: 10, fill: 1234 });
  const pcm = wavToPcm16kMono(src);
  assert.equal(pcm.length, 20);
  for (let i = 0; i < 10; i += 1) assert.equal(pcm.readInt16LE(i * 2), 1234);
});

test('wavDurationSec：按时长过滤过短语音', () => {
  const oneSecond = makeWav({ sampleRate: 24000, channels: 1, frames: 24000 });
  assert.ok(Math.abs(wavDurationSec(oneSecond) - 1) < 0.001);
  const veryShort = makeWav({ sampleRate: 24000, channels: 1, frames: 2400 }); // 0.1 秒
  assert.ok(wavDurationSec(veryShort) < 0.5);
});

test('buildWav16kMono：头部字段正确', () => {
  const pcm = Buffer.alloc(320);
  const wav = buildWav16kMono(pcm);
  assert.equal(wav.length, 44 + 320);
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(4), 36 + 320);
  assert.equal(wav.readUInt32LE(40), 320);
});

test('prepareWavForWhisper：损坏/非 WAV 输入明确报错', () => {
  assert.throws(() => prepareWavForWhisper(Buffer.from('not a wav at all, definitely not')), /WAV/);
  assert.throws(() => prepareWavForWhisper(Buffer.alloc(10)), /WAV/);
});

test('parseWhisperText：去掉时间戳/日志/非语音标记，拼成一行', () => {
  const out = `
system_info: n_threads = 4
[00:00:00.000 --> 00:00:02.000]  你好，我是小金鱼。
[00:00:02.000 --> 00:00:04.000]  今天天气不错。
[BLANK_AUDIO]
total time = 1.2 s
`;
  assert.equal(parseWhisperText(out), '你好，我是小金鱼。 今天天气不错。');
  assert.equal(parseWhisperText('[00:00:00.000 --> 00:00:01.000] [音乐]'), '');
  assert.equal(parseWhisperText(''), '');
});

test('isBracketedOnly：整段被括号包住的字幕幻觉识别', () => {
  assert.equal(isBracketedOnly('(CC字幕製作:貝爾)'), true);
  assert.equal(isBracketedOnly('（字幕由 Amara.org 社区提供）'), true);
  assert.equal(isBracketedOnly('【字幕】 [music]'), true);
  assert.equal(isBracketedOnly('(真的吗) 太好啦'), false);   // 括号外有正文
  assert.equal(isBracketedOnly('你好呀'), false);             // 没有括号
  assert.equal(isBracketedOnly(''), false);
});

test('parseWhisperText：纯括号幻觉整条丢弃，正常内容不动', () => {
  assert.equal(parseWhisperText('(CC字幕製作:貝爾)'), '');
  assert.equal(parseWhisperText('（字幕由 Amara.org 社区提供）'), '');
  assert.equal(parseWhisperText('(真的吗) 太好啦'), '(真的吗) 太好啦');
  assert.equal(parseWhisperText('今天好开心呀'), '今天好开心呀');
});
