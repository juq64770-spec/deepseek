// 日记模块纯函数测试：不调用模型、不碰真实 QQ/DSH，只在临时目录里读写。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  appendDiaryEntry,
  diaryDayKey,
  formatDiaryEntries,
  formatLocalTime,
  loadDiaryEntries,
  localDayKey,
  normalizeDiaryEntry,
  recentDiaryEntries,
  resolveDiaryFile,
  sanitizeDiaryContent,
  sanitizeDiaryMood
} from '../src/diary-lib.js';

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-diary-'));
  return path.join(dir, 'diary.jsonl');
}

test('sanitizeDiaryContent：单行化、去控制字符、按上限截断', () => {
  assert.equal(sanitizeDiaryContent('第一行\n第二行\t第三行'), '第一行 第二行 第三行');
  assert.equal(sanitizeDiaryContent('  a\u0000b\u200bc  '), 'abc');
  assert.equal(sanitizeDiaryContent('一二三四五', 3), '一二三');
  assert.equal(sanitizeDiaryContent('😀😀😀', 1), '😀'); // 不切开代理对
  assert.equal(sanitizeDiaryContent(''), '');
  assert.equal(sanitizeDiaryContent(null), '');
});

test('sanitizeDiaryMood：短字段独立上限', () => {
  assert.equal(sanitizeDiaryMood('还行吧今天挺开心的', 12), '还行吧今天挺开心的'.slice(0, 12));
  assert.equal(sanitizeDiaryMood('烦\n躁'), '烦 躁');
});

test('normalizeDiaryEntry：拒绝空内容、补齐时间与 ts', () => {
  assert.equal(normalizeDiaryEntry({ content: '' }), null);
  assert.equal(normalizeDiaryEntry(null), null);
  const fromTime = normalizeDiaryEntry({ time: '2026-10-21 20:00', content: '梨没回来' });
  assert.equal(fromTime.time, '2026-10-21 20:00');
  assert.equal(fromTime.content, '梨没回来');
  assert.ok(fromTime.ts > 0);
  assert.equal(diaryDayKey(fromTime), '2026-10-21');
  const fromTs = normalizeDiaryEntry({ ts: new Date(2026, 9, 21, 8, 30).getTime(), content: '早' });
  assert.equal(fromTs.time, '2026-10-21 08:30');
});

test('appendDiaryEntry：追加、每天上限、第二天恢复', () => {
  const file = tempFile();
  const day1 = new Date(2026, 9, 21, 10, 0);
  const r1 = appendDiaryEntry(file, { content: '第一条', now: day1, maxPerDay: 3 });
  assert.equal(r1.ok, true);
  assert.equal(r1.todayCount, 1);
  const r2 = appendDiaryEntry(file, { content: '第二条\n带换行', mood: '还行', now: day1, maxPerDay: 3 });
  assert.equal(r2.ok, true);
  assert.equal(r2.entry.content, '第二条 带换行');
  assert.equal(r2.entry.mood, '还行');
  const r3 = appendDiaryEntry(file, { content: '第三条', now: day1, maxPerDay: 3 });
  assert.equal(r3.ok, true);
  const r4 = appendDiaryEntry(file, { content: '第四条', now: day1, maxPerDay: 3 });
  assert.equal(r4.ok, false);
  assert.match(r4.error, /上限 3 条/);
  // 第二天重新计数
  const day2 = new Date(2026, 9, 22, 9, 0);
  const r5 = appendDiaryEntry(file, { content: '新的一天', now: day2, maxPerDay: 3 });
  assert.equal(r5.ok, true);
  assert.equal(r5.todayCount, 1);
  // 文件中真实有 4 行（一行一条）
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 4);
  lines.forEach((line) => assert.ok(JSON.parse(line).content));
  const entries = loadDiaryEntries(file);
  assert.equal(entries.length, 4);
  assert.equal(localDayKey(day1), '2026-10-21');
  assert.equal(formatLocalTime(day1), '2026-10-21 10:00');
});

test('loadDiaryEntries：文件不存在=空；坏行跳过；BOM 兼容', () => {
  const file = tempFile();
  assert.deepEqual(loadDiaryEntries(file), []);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '\ufeff{"time":"2026-10-21 10:00","content":"好"}\nnot-json\n{"content":""}\n\n{"time":"2026-10-21 11:00","content":"第二"}\n', 'utf8');
  const entries = loadDiaryEntries(file);
  assert.equal(entries.length, 2);
  assert.equal(entries[1].content, '第二');
});

test('recentDiaryEntries：最新在前、关键词过滤、条数上限', () => {
  const entries = [
    { time: '2026-10-19 10:00', ts: 1, mood: '', content: '买了梨' },
    { time: '2026-10-20 10:00', ts: 2, mood: '烦', content: '他今天没来' },
    { time: '2026-10-21 10:00', ts: 3, mood: '', content: '梨没回来' }
  ];
  const all = recentDiaryEntries(entries, { limit: 2 });
  assert.equal(all.total, 3);
  assert.equal(all.matched, 3);
  assert.deepEqual(all.entries.map((e) => e.content), ['梨没回来', '他今天没来']);
  const searched = recentDiaryEntries(entries, { limit: 10, query: '梨' });
  assert.equal(searched.matched, 2);
  assert.deepEqual(searched.entries.map((e) => e.content), ['梨没回来', '买了梨']);
  const moodSearch = recentDiaryEntries(entries, { limit: 10, query: '烦' });
  assert.deepEqual(moodSearch.entries.map((e) => e.content), ['他今天没来']);
  assert.equal(recentDiaryEntries([], {}).entries.length, 0);
});

test('formatDiaryEntries：空本/无匹配/正常列表', () => {
  assert.equal(formatDiaryEntries({ total: 0, matched: 0, entries: [] }), '（日记本还是空的）');
  assert.equal(formatDiaryEntries({ total: 3, matched: 0, entries: [] }), '（日记里没有匹配这个关键词的内容）');
  const text = formatDiaryEntries({
    total: 1,
    matched: 1,
    entries: [{ time: '2026-10-21 10:00', mood: '还行', content: '梨没回来' }]
  });
  assert.equal(text, '- 2026-10-21 10:00（还行） 梨没回来');
});

test('resolveDiaryFile：只允许仓库内相对路径', () => {
  const root = path.resolve(os.tmpdir(), 'qq-bridge-root');
  const ok = resolveDiaryFile(root, 'state/diary/diary.jsonl');
  assert.equal(ok, path.join(root, 'state', 'diary', 'diary.jsonl'));
  assert.throws(() => resolveDiaryFile(root, '../outside.jsonl'), /仓库内/);
  assert.throws(() => resolveDiaryFile(root, 'C:\\Windows\\temp\\x.jsonl'), /仓库内/);
  // 空值走默认路径（默认值本身必须是仓库内相对路径）
  assert.equal(resolveDiaryFile(root, ''), path.join(root, 'state', 'diary', 'diary.jsonl'));
});
