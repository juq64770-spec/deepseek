// 日记（她自己的一本小册子）——纯函数 + JSONL 追加存储。
//
// 设计原则（照 deepseek 进阶篇的规矩）：
// - 一行一条、纯文本：能直接双击打开、grep、手改；写入只追加，不提供删除/改写工具。
// - 「写一条」「看最近几条」两个动作就够，别把日记做成任务清单。
// - 文件损坏时**不重写**（只追加），读取坏行跳过不影响其余条目；写盘失败抛错由调用方处理。
// - 内容单行化：换行/制表符压成空格，避免一条日记在文件里裂成多行、破坏 JSONL 结构。

import fs from 'node:fs';
import path from 'node:path';
import { truncateText } from './md-to-plain.js';

export const DIARY_DEFAULT_FILE = 'state/diary/diary.jsonl';
export const DIARY_DEFAULT_MAX_CHARS = 300;
export const DIARY_DEFAULT_MAX_PER_DAY = 3;

/** 单行化 + 去控制字符 + 按码点截断。空内容返回 ''。 */
export function sanitizeDiaryContent(value, max = DIARY_DEFAULT_MAX_CHARS) {
  const limit = Math.max(1, Math.floor(Number(max) || DIARY_DEFAULT_MAX_CHARS));
  const cleaned = String(value ?? '')
    .replace(/[\r\n\t\u00a0\u3000]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '')
    .trim();
  return truncateText(cleaned, limit);
}

/** 心情/标签这类短字段：单行化 + 短上限。 */
export function sanitizeDiaryMood(value, max = 12) {
  return sanitizeDiaryContent(value, max);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 本地时区的 "YYYY-MM-DD HH:mm"（给人看的，也是 SQLite 式的可 grep 时间）。 */
export function formatLocalTime(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 本地时区的 "YYYY-MM-DD"（算“今天写了几条”用）。 */
export function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 归一化一条日记；结构不合法返回 null（读取时用来跳过坏行）。 */
export function normalizeDiaryEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const content = sanitizeDiaryContent(raw.content, 2000);
  if (!content) return null;
  const mood = sanitizeDiaryMood(raw.mood, 12);
  const time = String(raw.time ?? '').trim().slice(0, 20);
  const ts = Number(raw.ts) || (time ? Date.parse(time.replace(' ', 'T')) || 0 : 0);
  return { time: time || (ts ? formatLocalTime(new Date(ts)) : ''), ts, mood, content };
}

/** 条目属于哪一天（本地日期）。优先用 time 的日期部分，其次用 ts。 */
export function diaryDayKey(entry) {
  const time = String(entry?.time ?? '');
  if (/^\d{4}-\d{2}-\d{2}/.test(time)) return time.slice(0, 10);
  if (Number(entry?.ts) > 0) return localDayKey(new Date(Number(entry.ts)));
  return '';
}

/**
 * 读取日记文件。
 * @returns 条目数组；文件不存在时为空数组（首次使用的正常情况）。
 * @throws 文件存在但读不动/不是文本时抛出（交给调用方报错，不静默当空）。
 */
export function loadDiaryEntries(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw new Error(`日记读取失败（${error?.message ?? error}）`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = normalizeDiaryEntry(JSON.parse(trimmed));
      if (entry) entries.push(entry);
    } catch {
      // 单行损坏（手改坏/崩溃时写了一半）跳过即可：我们只追加，不会覆盖原文件。
    }
  }
  return entries;
}

/** 把配置里的相对路径解析到仓库根目录内；绝对路径或越界路径一律拒绝。 */
export function resolveDiaryFile(rootDir, configuredPath) {
  const raw = String(configuredPath ?? '').trim() || DIARY_DEFAULT_FILE;
  const abs = path.resolve(rootDir, raw);
  const rel = path.relative(rootDir, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`日记文件路径必须是仓库内的相对路径（当前：${raw}）`);
  }
  return abs;
}

/**
 * 追加一条日记，并执行“一天最多几条”的限制。
 *
 * @param file 日记文件绝对路径。
 * @param options.content 正文。
 * @param options.mood 可选心情/标签（最多 12 字）。
 * @param options.now 当前时间（测试可注入）。
 * @param options.maxChars 单条正文上限。
 * @param options.maxPerDay 每天条数上限；<=0 表示不限制。
 * @returns {ok:true, entry, todayCount, maxPerDay} 或 {ok:false, error, todayCount, maxPerDay}
 */
export function appendDiaryEntry(file, { content, mood = '', now = new Date(), maxChars = DIARY_DEFAULT_MAX_CHARS, maxPerDay = DIARY_DEFAULT_MAX_PER_DAY } = {}) {
  const clean = sanitizeDiaryContent(content, maxChars);
  if (!clean) return { ok: false, error: '日记内容不能为空' };
  const limit = Math.max(0, Math.floor(Number(maxPerDay) || 0));
  const entries = loadDiaryEntries(file);
  const today = localDayKey(now);
  const todayCount = entries.filter((e) => diaryDayKey(e) === today).length;
  if (limit > 0 && todayCount >= limit) {
    return { ok: false, error: `今天已经写了 ${todayCount} 条日记（上限 ${limit} 条），明天再说吧`, todayCount, maxPerDay: limit };
  }
  const entry = {
    time: formatLocalTime(now),
    ts: now.getTime(),
    mood: sanitizeDiaryMood(mood, 12),
    content: clean
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { ok: true, entry, todayCount: todayCount + 1, maxPerDay: limit };
}

/**
 * 取最近的日记（可按关键词过滤）。
 * 返回 newest-first：模型看“最近几条”时，最新的一条在最前面。
 */
export function recentDiaryEntries(entries, { limit = 5, query = '' } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const max = Math.max(1, Math.min(50, Math.floor(Number(limit) || 5)));
  const q = String(query ?? '').trim().toLowerCase();
  const filtered = q
    ? list.filter((e) => `${e.content ?? ''} ${e.mood ?? ''}`.toLowerCase().includes(q))
    : list;
  return {
    total: list.length,
    matched: filtered.length,
    entries: filtered.slice(-max).reverse()
  };
}

/** 给模型看的纯文本列表（也便于控制台直接展示）。 */
export function formatDiaryEntries(result) {
  const entries = Array.isArray(result?.entries) ? result.entries : [];
  if (!entries.length) {
    if (Number(result?.matched) === 0 && Number(result?.total) > 0) return '（日记里没有匹配这个关键词的内容）';
    return '（日记本还是空的）';
  }
  return entries
    .map((e) => `- ${e.time}${e.mood ? `（${e.mood}）` : ''} ${e.content}`)
    .join('\n');
}
