// 手动验收：把任意本地音频（WAV）交给本地 Whisper 转写。
// 用法：npm run stt -- "D:\某条语音.wav" [--model tools/whisper/models/ggml-base.bin] [--lang zh] [--threads 4]
// 说明：这个脚本只读文件，不联网、不发 QQ；用来在没装网易云/没收到语音消息时单独验证模型和 CPU 耗时。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transcribeWavBuffer, wavDurationSec } from '../src/stt-lib.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch { return {}; }
}

const argv = process.argv.slice(2);
if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
  console.log('用法：npm run stt -- <音频文件.wav> [--model 模型路径] [--lang zh] [--threads 4]');
  console.log('默认读取 config.json 的 socialV2.stt.binaryPath / modelPath / language / threads。');
  process.exit(argv.length ? 0 : 1);
}

const file = path.resolve(argv[0]);
const getFlag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const cfg = readConfig();
const stt = cfg.socialV2?.stt ?? {};
const resolveRepoPath = (p, fallback) => {
  const raw = String(p ?? '').trim() || fallback;
  return path.resolve(ROOT, raw);
};

const binaryPath = resolveRepoPath(stt.binaryPath, 'tools/whisper/Release/whisper-cli.exe');
let modelPath = resolveRepoPath(getFlag('--model') || stt.modelPath, 'tools/whisper/models/ggml-base.bin');
if (!fs.existsSync(modelPath)) {
  const base = path.join(path.dirname(modelPath), 'ggml-base.bin');
  if (fs.existsSync(base)) {
    console.log(`（配置的模型不存在，改用 ${path.relative(ROOT, base)}）`);
    modelPath = base;
  }
}

if (!fs.existsSync(file)) {
  console.error(`找不到音频文件：${file}`);
  process.exit(2);
}
if (!fs.existsSync(binaryPath)) {
  console.error(`找不到 whisper 可执行文件：${binaryPath}`);
  process.exit(2);
}
if (!fs.existsSync(modelPath)) {
  console.error(`找不到 whisper 模型：${modelPath}`);
  process.exit(2);
}

const buf = fs.readFileSync(file);
let duration = 0;
try { duration = wavDurationSec(buf); } catch {}
console.log(`文件：${path.basename(file)}（${(buf.length / 1024).toFixed(1)} KB${duration ? `，${duration.toFixed(1)} 秒` : ''}）`);
console.log(`模型：${path.relative(ROOT, modelPath)}`);
const started = Date.now();
try {
  const text = await transcribeWavBuffer(buf, {
    binaryPath,
    modelPath,
    language: getFlag('--lang') || stt.language || 'zh',
    threads: getFlag('--threads') || stt.threads || 4,
    timeoutMs: stt.timeoutMs || 60000
  });
  console.log(`耗时：${((Date.now() - started) / 1000).toFixed(1)} 秒`);
  console.log(text ? `转写：${text}` : '转写：（没有识别出文字）');
} catch (error) {
  console.error(`转写失败：${error?.message ?? error}`);
  process.exit(3);
}
