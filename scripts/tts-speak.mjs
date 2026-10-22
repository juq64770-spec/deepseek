// TTS 命令行工具：文字 → 语音文件。
//
// 用法：
//   npm run tts -- "晚上好呀"                      合成到默认输出目录
//   npm run tts -- "你好" --voice zh-CN-XiaoxiaoNeural --out E:\out.mp3
//   npm run tts -- --help                          查看全部参数
//
// 默认经本机代理 7897 访问（本机直连 Bing 经常超时）；没有代理时用 --proxy "" 关闭。
import { synthesizeTextToFile, TTS_DEFAULT_VOICE, TTS_KNOWN_VOICES } from '../src/tts-lib.js';

function parseArgs(argv) {
  const opts = { voice: TTS_DEFAULT_VOICE, rate: '+0%', volume: '+0%', pitch: '+0Hz', proxy: 'http://127.0.0.1:7897', out: null };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--voice') { opts.voice = argv[++i]; continue; }
    if (a === '--rate') { opts.rate = argv[++i]; continue; }
    if (a === '--volume') { opts.volume = argv[++i]; continue; }
    if (a === '--pitch') { opts.pitch = argv[++i]; continue; }
    if (a === '--proxy') { opts.proxy = argv[++i] === '' ? null : argv[++i]; continue; }
    if (a === '--out') { opts.out = argv[++i]; continue; }
    if (a === '--list-voices') return { listVoices: true };
    if (!a.startsWith('--')) pos.push(a);
  }
  return { ...opts, text: pos.join(' ') };
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed.help || (!parsed.text && !parsed.listVoices)) {
  console.log([
    'TTS 合成工具（edge-tts）',
    '',
    '用法：npm run tts -- "要说的文字" [选项]',
    '',
    '选项：',
    '  --voice <音色>      默认 ' + TTS_DEFAULT_VOICE,
    '                     可选：' + TTS_KNOWN_VOICES.join(' / '),
    '  --rate <语速>       +N% 或 -N%（默认 +0%）',
    '  --volume <音量>     +N% 或 -N%（默认 +0%）',
    '  --pitch <音调>      +NHz 或 -NHz（默认 +0Hz）',
    '  --proxy <代理>      默认 http://127.0.0.1:7897；不要代理传空字符串 ""',
    '  --out <路径>        输出文件路径（默认系统临时目录，打印路径）',
    '  --list-voices       只列出已知中文音色',
    '  --help              显示本帮助'
  ].join('\n'));
  process.exit(parsed.help ? 0 : 1);
}
if (parsed.listVoices) {
  console.log(TTS_KNOWN_VOICES.join('\n'));
  process.exit(0);
}

try {
  const t0 = Date.now();
  const res = await synthesizeTextToFile(parsed.text, {
    voice: parsed.voice,
    rate: parsed.rate,
    volume: parsed.volume,
    pitch: parsed.pitch,
    proxy: parsed.proxy
  });
  let dest = res.path;
  if (parsed.out) {
    const { copyFileSync } = await import('node:fs');
    copyFileSync(res.path, parsed.out);
    dest = parsed.out;
    const { cleanupTtsTemp } = await import('../src/tts-lib.js');
    cleanupTtsTemp(res.path);
  }
  console.log(`文件：${dest}`);
  console.log(`内容：${res.text}`);
  console.log(`音色：${res.voice}`);
  console.log(`大小：${(res.bytes / 1024).toFixed(1)} KB，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
} catch (error) {
  console.error(`合成失败：${error?.message ?? error}`);
  process.exit(1);
}
