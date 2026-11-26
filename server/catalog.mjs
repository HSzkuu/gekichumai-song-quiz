/**
 * 服务端曲库加载器。
 * 直接复用前端生成的 assets/js/data.js（LXNS 全量曲库），避免维护两份数据。
 * 之后迁移 Cloudflare Workers 时，可以把这份数据换成 D1 / R2 / KV 读取。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadCatalog(root) {
  const file = join(root, 'assets', 'js', 'data.js');
  const raw = readFileSync(file, 'utf8');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('data.js 格式异常');
  const data = JSON.parse(raw.slice(start, end + 1));
  const songs = (data.songs || []).filter((s) => s.playable && s.id < 100000);
  const categories = (data.categories || []).filter((c) => c.count > 0);
  if (!songs.length) throw new Error('曲库为空');
  return {
    data,
    songs,
    categories,
    catKeys: new Set(categories.map((c) => c.key)),
  };
}
