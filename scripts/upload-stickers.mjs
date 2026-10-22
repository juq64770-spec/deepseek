// 上传本地表情到 QQ 收藏（OneBot add_custom_face）
//
// 用法：node scripts/upload-stickers.mjs <manifest.json>
// manifest 格式：[{ "file": "路径（相对 manifest 所在目录）", "desc": "备注（可选）" }]
//
// 走 SnowLuma 的 HTTP API（config.json 的 snowluma.httpUrl / accessToken），
// 上传成功后用 modify_custom_face 写备注。不会打印 accessToken。
import fs from 'node:fs';
import path from 'node:path';

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('用法：node scripts/upload-stickers.mjs <manifest.json>');
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(path.resolve('config.json'), 'utf8'));
const baseUrl = String(cfg.snowluma?.httpUrl || '').replace(/\/+$/, '');
const token = String(cfg.snowluma?.accessToken || '');
if (!baseUrl || !token) {
  console.error('config.json 里缺少 snowluma.httpUrl 或 accessToken');
  process.exit(1);
}

const absManifest = path.resolve(manifestPath);
const baseDir = path.dirname(absManifest);
const items = JSON.parse(fs.readFileSync(absManifest, 'utf8'));
if (!Array.isArray(items) || !items.length) {
  console.error('manifest 必须是非空数组');
  process.exit(1);
}

async function call(action, params, timeoutMs = 30000) {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, params }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!data) throw new Error(`${action} 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
  if (data.status !== 'ok' || data.retcode !== 0) {
    throw new Error(`${action} 失败：${data.wording || data.retcode || 'unknown'}`);
  }
  return data.data;
}

const results = [];
let failed = 0;
for (const item of items) {
  const file = path.resolve(baseDir, item.file);
  const label = path.basename(file);
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size === 0) throw new Error('文件不存在或为空');
    if (st.size > 5 * 1024 * 1024) throw new Error(`文件过大（${(st.size / 1024 / 1024).toFixed(1)} MB）`);
    const fileParam = 'base64://' + fs.readFileSync(file).toString('base64');
    const added = await call('add_custom_face', { file: fileParam }, 60000);
    const emojiId = String(added?.emoji_id || '');
    if (!emojiId) throw new Error('add_custom_face 未返回 emoji_id');
    let remarkOk = true;
    if (item.desc) {
      try {
        await call('modify_custom_face', { emoji_id: emojiId, desc: String(item.desc).slice(0, 20) });
      } catch (error) {
        remarkOk = false;
        console.warn(`   ⚠ 备注写入失败：${error?.message ?? error}`);
      }
    }
    results.push({ file: label, emojiId, desc: item.desc || '', remarkOk, bytes: st.size });
    console.log(`ok   ${label} → ${emojiId}${item.desc ? `（${item.desc}）` : ''}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${label}：${error?.message ?? error}`);
  }
}

const outPath = path.join(baseDir, 'upload-results.json');
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\n成功 ${results.length}，失败 ${failed}，结果写入 ${outPath}`);
if (failed > 0) process.exit(1);
