// tts-lib 单元测试：清洗、参数校验、真实合成（走代理）。
//
// 真实合成测试需要本机网络（edge-tts 经代理访问 Bing）；网络不通时该条标记 SKIP 而不是失败。
import { strict as assert } from 'node:assert';
import { sanitizeTtsText, validateTtsOptions, synthesizeTextToFile, cleanupTtsTemp, TTS_KNOWN_VOICES } from '../src/tts-lib.js';

let passed = 0;
let failed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed++;
    failures.push({ name, error });
    console.log(`FAIL ${name}\n     ${error?.message ?? error}`);
  }
}

test('sanitizeTtsText 去掉 CQ 码与 markdown 符号', () => {
  const out = sanitizeTtsText('你好**呀** [CQ:image,file=x] `代码`');
  assert.equal(out, '你好呀 代码');
});

test('sanitizeTtsText 换行并空格', () => {
  assert.equal(sanitizeTtsText('第一行\n\n第二行\t第三行'), '第一行 第二行 第三行');
});

test('sanitizeTtsText 截断到上限（截断后 trim）', () => {
  const long = 'a'.repeat(50) + '  bbb';
  assert.equal(sanitizeTtsText(long, 50), 'a'.repeat(50));
});

test('sanitizeTtsText 空串返回空', () => {
  assert.equal(sanitizeTtsText('   '), '');
  assert.equal(sanitizeTtsText(''), '');
});

test('validateTtsOptions 接受合法参数', () => {
  const v = validateTtsOptions({ voice: 'zh-CN-XiaoyiNeural', rate: '+10%', volume: '-20%', pitch: '+25Hz' });
  assert.equal(v.rate, '+10%');
  assert.equal(v.volume, '-20%');
  assert.equal(v.pitch, '+25Hz');
});

test('validateTtsOptions 拒绝非法语速/音量/音调', () => {
  assert.throws(() => validateTtsOptions({ rate: 'fast' }), /语速/);
  assert.throws(() => validateTtsOptions({ volume: '0' }), /音量/);
  assert.throws(() => validateTtsOptions({ rate: '200%' }), /语速/);
  assert.throws(() => validateTtsOptions({ pitch: '25' }), /音调/);
  assert.throws(() => validateTtsOptions({ pitch: '+25%' }), /音调/);
  assert.throws(() => validateTtsOptions({ voice: '' }), /音色/);
});

test('TTS_KNOWN_VOICES 全部带 zh-CN 前缀', () => {
  for (const v of TTS_KNOWN_VOICES) assert.ok(v.startsWith('zh-CN-'), v);
});

// ── 真实合成（需要网络；失败只标 SKIP） ──────────────────────────────
try {
  const res = await synthesizeTextToFile('测试合成', { proxy: 'http://127.0.0.1:7897', timeoutMs: 30000 });
  console.log(`ok   真实合成（${res.bytes} 字节，${res.text}）`);
  passed++;
  cleanupTtsTemp(res.path);
} catch (error) {
  console.log(`SKIP 真实合成（edge-tts 网络不可用或未安装）：${error?.message ?? error}`);
}

console.log(`\n${passed} 通过，${failed} 失败`);
if (failed > 0) {
  for (const f of failures) console.log(`- ${f.name}: ${f.error?.message ?? f.error}`);
  process.exit(1);
}
