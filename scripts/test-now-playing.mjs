// 「听歌」读取器纯函数测试：不依赖网易云安装，也不读真实播放状态。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeNowPlaying,
  normalizeWindowFallback,
  parseNowPlayingOutput,
  parseWindowTitle
} from '../src/music-lib.js';

test('parseNowPlayingOutput：取最后一行 JSON，容忍前置噪音', () => {
  const out = 'WARNING: something\n{"ok":true,"title":"晴天"}\n';
  assert.deepEqual(parseNowPlayingOutput(out), { ok: true, title: '晴天' });
  const out2 = '{"ok":false,"reason":"no-session"}\n{"ok":true,"title":"七里香"}\n';
  assert.equal(parseNowPlayingOutput(out2).title, '七里香');
  assert.throws(() => parseNowPlayingOutput(''), /没有输出/);
  assert.throws(() => parseNowPlayingOutput('not json at all'), /不是 JSON/);
});

test('normalizeNowPlaying：SMTC 结果归一化', () => {
  const playing = normalizeNowPlaying({
    ok: true,
    source: 'smtc',
    app: 'CloudMusic.exe',
    netease: true,
    title: ' 晴天 ',
    artist: '周杰伦',
    album: '叶惠美',
    status: 'playing',
    positionSec: 61.26,
    durationSec: 269.1
  });
  assert.deepEqual(playing, {
    ok: true,
    source: 'smtc',
    app: 'CloudMusic.exe',
    netease: true,
    title: '晴天',
    artist: '周杰伦',
    album: '叶惠美',
    status: 'PLAYING',
    positionSec: 61.3,
    durationSec: 269.1
  });
  assert.equal(normalizeNowPlaying({ ok: true, title: '' }).reason, 'no-title');
  assert.equal(normalizeNowPlaying({ ok: true, title: '网易云音乐' }).reason, 'no-title');
  const off = normalizeNowPlaying({ ok: false, reason: 'no-session', error: 'x' });
  assert.equal(off.ok, false);
  assert.equal(off.reason, 'no-session');
});

test('parseWindowTitle：歌名/歌手切分与无效标题', () => {
  assert.deepEqual(parseWindowTitle('晴天 - 周杰伦'), { title: '晴天', artist: '周杰伦' });
  // 最后一个「 - 」才是歌手分隔符（歌名自身可能带横线）
  assert.deepEqual(parseWindowTitle('卡农 - 钢琴版 - 帕赫贝尔'), { title: '卡农 - 钢琴版', artist: '帕赫贝尔' });
  assert.deepEqual(parseWindowTitle('网易云音乐 - 周杰伦 - 网易云音乐'), { title: '网易云音乐', artist: '周杰伦' });
  assert.deepEqual(parseWindowTitle('只有歌名'), { title: '只有歌名', artist: '' });
  assert.equal(parseWindowTitle('网易云音乐'), null);
  assert.equal(parseWindowTitle(''), null);
  assert.equal(parseWindowTitle(null), null);
});

test('normalizeWindowFallback：窗口标题兜底形状与 SMTC 一致', () => {
  const r = normalizeWindowFallback({ title: '夜曲 - 周杰伦', app: 'cloudmusic' });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'window-title');
  assert.equal(r.title, '夜曲');
  assert.equal(r.artist, '周杰伦');
  assert.equal(r.positionSec, null);
  assert.equal(normalizeWindowFallback({ title: '网易云音乐' }).ok, false);
});
