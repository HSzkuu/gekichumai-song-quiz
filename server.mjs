#!/usr/bin/env node
/**
 * 舞萌听歌大作战 · 全服排行榜服务
 * ------------------------------------------------------------
 * - 纯 Node.js（>= 22.5）内置 sqlite，无第三方依赖
 * - 静态站点 + /api/leaderboard
 * - SQL 与表结构刻意保持 SQLite 原生写法，之后可整体迁移到
 *   Cloudflare Workers + D1（D1 同样是 SQLite，schema.sql 可直接导入）
 *
 * 启动：
 *   node server.mjs                 # 0.0.0.0:8130
 *   PORT=8090 HOST=127.0.0.1 node server.mjs
 *   DB_PATH=/var/lib/mai-quiz.sqlite node server.mjs
 *
 * 迁移到 Cloudflare 时：
 *   1. wrangler d1 execute mai-quiz --file=db/schema.sql
 *   2. 把 db.prepare(...).all(...) 换成 env.DB.prepare(...).bind(...).all()
 *   3. 静态资源可放 Workers Assets / Pages，API 路径保持 /api/leaderboard
 */

import http from 'node:http';
import os from 'node:os';
import { createReadStream, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadCatalog } from './server/catalog.mjs';
import { attachRealtime } from './server/rooms.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

/* ============================== config ============================== */
function argValue(name, fallback) {
  const exact = process.argv.indexOf(name);
  if (exact !== -1 && process.argv[exact + 1] && !process.argv[exact + 1].startsWith('--')) {
    return process.argv[exact + 1];
  }
  const prefix = `${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const PORT = Number(argValue('--port', process.env.PORT || 8130)) || 8130;
const HOST = argValue('--host', process.env.HOST || '0.0.0.0');
const DB_PATH = process.env.DB_PATH || argValue('--db', join(ROOT, 'data', 'leaderboard.sqlite'));

/* ============================== database ============================== */
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
db.exec(readFileSync(join(ROOT, 'db', 'schema.sql'), 'utf8'));

let catalog = null;
try {
  catalog = loadCatalog(ROOT);
  console.log(`[catalog] ${catalog.songs.length} playable songs / ${catalog.categories.length} categories`);
} catch (err) {
  console.error('[catalog] failed to load song data:', err.message);
}

const MODES = new Set(['challenge', 'royale', 'genre']);
const CLIPS = new Set([5, 15, 30]);
const ORDER = {
  score: 'score DESC, accuracy DESC, avg_time ASC, id ASC',
  royale: 'max_combo DESC, score DESC, accuracy DESC, avg_time ASC, id ASC',
};
const boardOrder = (mode) => (mode === 'royale' ? ORDER.royale : ORDER.score);

const insertScore = db.prepare(`
  INSERT INTO scores
    (client_id, cn, mode, clip, question_count, scope, score, accuracy, avg_time,
     max_combo, correct, answered, pool_size, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const lastSubmission = db.prepare('SELECT created_at FROM scores WHERE client_id = ? ORDER BY id DESC LIMIT 1');
const countAll = db.prepare('SELECT COUNT(*) AS total FROM scores');
const totalPlayers = db.prepare('SELECT COUNT(DISTINCT client_id) AS total FROM scores');

/* ============================== helpers ============================== */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const limit = 32 * 1024;
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) { rejectBody(new HttpError(413, '请求体过大')); return; }
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolveBody(JSON.parse(raw));
      } catch {
        rejectBody(new HttpError(400, 'JSON 格式无效'));
      }
    });
    req.on('error', (err) => rejectBody(err));
  });
}

function sanitizeCn(value) {
  const clean = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  return clean || '舞萌玩家';
}

function integer(value, min, max, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${field} 无效`);
  }
  return n;
}

function finite(value, min, max, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new HttpError(400, `${field} 无效`);
  }
  return n;
}

function validateSubmission(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpError(400, '请求体必须是对象');
  }
  const mode = String(raw.mode || '');
  if (!MODES.has(mode)) throw new HttpError(400, 'mode 无效');
  const clip = integer(raw.clip, 1, 300, 'clip');
  if (!CLIPS.has(clip)) throw new HttpError(400, 'clip 无效');

  const scope = raw.scope === 'custom' ? 'custom' : 'full';
  const questionCount = integer(raw.count, 1, 5000, 'count');
  const answered = integer(raw.answered, 1, questionCount, 'answered');
  const correct = integer(raw.correct, 0, answered, 'correct');
  const score = integer(raw.score, 0, answered * 1200, 'score');
  const maxCombo = integer(raw.maxCombo, 0, correct, 'maxCombo');
  const poolSize = integer(raw.poolSize, 1, 5000, 'poolSize');
  const avgTime = Math.round(finite(raw.avgTime, 0, 600, 'avgTime') * 100) / 100;
  const accuracy = finite(raw.accuracy, 0, 100, 'accuracy');
  const clientId = String(raw.clientId || '').trim();

  if (!/^[A-Za-z0-9_-]{8,80}$/.test(clientId)) {
    throw new HttpError(400, 'clientId 无效');
  }
  if (mode !== 'royale' && answered !== questionCount) {
    throw new HttpError(400, '常规模式必须完成全部题目');
  }
  const expected = Math.round((correct / answered) * 1000) / 10;
  if (Math.abs(accuracy - expected) > 0.11) {
    throw new HttpError(400, '准确率与答题数不一致');
  }

  const last = lastSubmission.get(clientId);
  if (last && Date.now() - Date.parse(last.created_at) < 3500) {
    throw new HttpError(429, '提交太频繁，请稍后再试');
  }

  return {
    clientId,
    cn: sanitizeCn(raw.cn),
    mode,
    clip,
    questionCount,
    scope,
    score,
    accuracy: expected,
    avgTime,
    maxCombo,
    correct,
    answered,
    poolSize,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 全服榜按“每位玩家在该筛选条件下的最佳一局”展示。
 * 这样榜单不会被同一位玩家的多次提交刷屏，也方便之后迁移 D1。
 */
function queryBoard(modeParam, clipParam, limit, scopeParam) {
  const where = [];
  const params = [];
  if (modeParam && modeParam !== 'all') {
    where.push('mode = ?');
    params.push(modeParam);
  }
  if (clipParam && clipParam !== 'all') {
    where.push('clip = ?');
    params.push(clipParam);
  }
  if (scopeParam && scopeParam !== 'all') {
    where.push('scope = ?');
    params.push(scopeParam);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = boardOrder(modeParam || 'all');

  const sql = `
    WITH ranked_runs AS (
      SELECT s.*,
             ROW_NUMBER() OVER (PARTITION BY s.client_id ORDER BY ${order}) AS rn
      FROM scores s
      ${whereSql}
    ),
    best AS (
      SELECT * FROM ranked_runs WHERE rn = 1
    ),
    ranked_best AS (
      SELECT *,
             ROW_NUMBER() OVER (ORDER BY ${order}) AS rank
      FROM best
    )
    SELECT id, cn, mode, clip, scope, question_count AS "count", score, accuracy,
           avg_time AS "avgTime", max_combo AS "maxCombo", correct, answered,
           pool_size AS "poolSize", created_at AS "date", rank
    FROM ranked_best
    ORDER BY ${order}
    LIMIT ?
  `;
  const records = db.prepare(sql).all(...params, limit);
  const totalRow = db.prepare(`SELECT COUNT(DISTINCT client_id) AS total FROM scores ${whereSql}`).get(...params);
  return { records, total: Number(totalRow?.total || 0) };
}

function bestRank(mode, clip, clientId, scope) {
  const order = boardOrder(mode);
  const sql = `
    WITH ranked_runs AS (
      SELECT s.*,
             ROW_NUMBER() OVER (PARTITION BY s.client_id ORDER BY ${order}) AS rn
      FROM scores s
      WHERE mode = ? AND clip = ? AND scope = ?
    ),
    best AS (
      SELECT * FROM ranked_runs WHERE rn = 1
    ),
    ranked AS (
      SELECT client_id,
             ROW_NUMBER() OVER (ORDER BY ${order}) AS rank
      FROM best
    )
    SELECT rank FROM ranked WHERE client_id = ?
  `;
  const row = db.prepare(sql).get(mode, clip, scope, clientId);
  return row ? Number(row.rank) : null;
}

/* ============================== API ============================== */
async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  if (url.pathname === '/api/health') {
    const row = countAll.get();
    sendJson(res, 200, { ok: true, records: Number(row?.total || 0), players: Number(totalPlayers.get()?.total || 0) });
    return;
  }

  if (url.pathname !== '/api/leaderboard') {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  if (req.method === 'GET') {
    const mode = url.searchParams.get('mode') || 'all';
    const clip = url.searchParams.get('clip') || 'all';
    const scope = url.searchParams.get('scope') || 'all';
    const limit = Number(url.searchParams.get('limit') || 50);
    if (mode !== 'all' && !MODES.has(mode)) throw new HttpError(400, 'mode 无效');
    if (clip !== 'all' && !CLIPS.has(Number(clip))) throw new HttpError(400, 'clip 无效');
    if (!['all', 'full', 'custom'].includes(scope)) throw new HttpError(400, 'scope 无效');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'limit 无效');
    const result = queryBoard(mode, clip === 'all' ? 'all' : Number(clip), limit, scope);
    sendJson(res, 200, {
      ok: true,
      mode,
      clip: clip === 'all' ? 'all' : Number(clip),
      scope,
      total: result.total,
      records: result.records,
      generatedAt: new Date().toISOString(),
    });
    return;
  }

  if (req.method === 'POST') {
    const raw = await readJsonBody(req);
    const data = validateSubmission(raw);
    const info = insertScore.run(
      data.clientId,
      data.cn,
      data.mode,
      data.clip,
      data.questionCount,
      data.scope,
      data.score,
      data.accuracy,
      data.avgTime,
      data.maxCombo,
      data.correct,
      data.answered,
      data.poolSize,
      data.createdAt,
    );
    const id = Number(info.lastInsertRowid);
    const rank = bestRank(data.mode, data.clip, data.clientId, data.scope);
    const total = queryBoard(data.mode, data.clip, 100, data.scope).total;
    console.log(`[score] ${data.cn} · ${data.mode}/${data.clip}s · ${data.score} · rank ${rank ?? '?'} · ${data.clientId.slice(0, 8)}…`);
    sendJson(res, 201, { ok: true, id, rank, total });
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}

/* ============================== static ============================== */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
};

function handleStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed');
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendText(res, 400, 'Bad path');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  if (!pathname || pathname.includes('\0')) { sendText(res, 400, 'Bad path'); return; }

  // Never expose the database or server internals over HTTP.
  if (
    pathname.startsWith('/data/') ||
    pathname === '/data' ||
    pathname.startsWith('/.') ||
    pathname === '/server.mjs' ||
    pathname.startsWith('/db/') ||
    pathname.startsWith('/tools/')
  ) {
    sendText(res, 404, 'Not found');
    return;
  }

  const filePath = resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(ROOT + sep)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    sendText(res, 404, 'Not found');
    return;
  }
  if (!stat.isFile()) { sendText(res, 404, 'Not found'); return; }

  const ext = extname(filePath).toLowerCase();
  const cache = ext === '.html' || ext === '.js' || ext === '.css'
    ? 'no-cache'
    : 'public, max-age=86400';
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) sendText(res, 500, 'Read error');
    else res.destroy();
  });
  stream.pipe(res);
}

/* ============================== server ============================== */
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error('[api]', err);
      if (!res.headersSent) sendJson(res, status, { error: err.message || '服务器错误' });
      else res.destroy();
    });
    return;
  }
  try {
    handleStatic(req, res, url);
  } catch (err) {
    console.error('[static]', err);
    if (!res.headersSent) sendText(res, 500, 'Server error');
  }
});

let wss = null;
if (catalog) {
  try {
    wss = attachRealtime(server, catalog);
  } catch (err) {
    console.error('[ws] failed to start multiplayer:', err.message);
  }
}

server.listen(PORT, HOST, () => {
  const row = countAll.get();
  console.log('');
  console.log('  舞萌听歌大作战 · 全服排行榜服务');
  console.log(`  DB      ${DB_PATH}  (${Number(row?.total || 0)} runs / ${Number(totalPlayers.get()?.total || 0)} players)`);
  console.log(`  Local   http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    const nets = os.networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const net of list || []) {
        if (net.family === 'IPv4' && !net.internal) console.log(`  LAN     http://${net.address}:${PORT}`);
      }
    }
  }
  console.log('');
});

function shutdown(signal) {
  console.log(`\n[server] ${signal}, closing…`);
  try {
    if (wss) {
      for (const client of wss.clients) { try { client.close(); } catch { /* ignore */ } }
      wss.close();
    }
  } catch { /* ignore */ }
  server.close(() => {
    try { db.close(); } catch { /* ignore */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
