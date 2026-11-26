#!/usr/bin/env node
/**
 * Cloudflare 迁移用的静态资源 / 曲库构建脚本。
 *
 * 产物：
 *   public/             → Workers Assets 静态目录（index.html + assets）
 *   worker/catalog.json → 供 Worker / Durable Object 导入的曲库
 *
 * 用法：
 *   npm run build:cf
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const workerDir = join(root, 'worker');

await rm(publicDir, { recursive: true, force: true });
await mkdir(join(publicDir, 'assets'), { recursive: true });
await cp(join(root, 'index.html'), join(publicDir, 'index.html'));
await cp(join(root, 'assets'), join(publicDir, 'assets'), { recursive: true });
console.log('[build:cf] public/ 已生成（index.html + assets）');

const raw = await readFile(join(root, 'assets', 'js', 'data.js'), 'utf8');
const start = raw.indexOf('{');
const end = raw.lastIndexOf('}');
if (start < 0 || end <= start) throw new Error('assets/js/data.js 格式异常');
const data = JSON.parse(raw.slice(start, end + 1));
const songs = (data.songs || []).filter((s) => s.playable && s.id < 100000);
const categories = (data.categories || []).filter((c) => c.count > 0);
if (!songs.length || !categories.length) throw new Error('曲库为空，构建终止');

const catalog = {
  songs,
  categories,
  catKeys: [...new Set(categories.map((c) => c.key))],
};
await mkdir(workerDir, { recursive: true });
await writeFile(join(workerDir, 'catalog.json'), JSON.stringify(catalog));
console.log(`[build:cf] worker/catalog.json：${songs.length} 首 / ${categories.length} 个分类`);
console.log('[build:cf] 下一步：wrangler d1 execute mai-quiz --remote --file=db/schema.d1.sql');
