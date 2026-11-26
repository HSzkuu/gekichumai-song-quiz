-- 舞萌听歌大作战 · 全服排行榜（SQLite / Cloudflare D1 兼容）
-- 说明：D1 本身就是 SQLite，可直接用 `wrangler d1 execute --file=db/schema.sql` 导入。
-- 本项目在 Node 侧使用内置 node:sqlite，不引入任何第三方依赖。

PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS scores (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      TEXT    NOT NULL,
  cn             TEXT    NOT NULL,
  mode           TEXT    NOT NULL CHECK (mode IN ('challenge', 'royale', 'genre')),
  clip           INTEGER NOT NULL CHECK (clip IN (5, 15, 30)),
  question_count INTEGER NOT NULL CHECK (question_count BETWEEN 1 AND 5000),
  scope          TEXT    NOT NULL DEFAULT 'full' CHECK (scope IN ('full', 'custom')),
  score          INTEGER NOT NULL CHECK (score >= 0),
  accuracy       REAL    NOT NULL CHECK (accuracy >= 0 AND accuracy <= 100),
  avg_time       REAL    NOT NULL CHECK (avg_time >= 0),
  max_combo      INTEGER NOT NULL CHECK (max_combo >= 0),
  correct        INTEGER NOT NULL CHECK (correct >= 0),
  answered       INTEGER NOT NULL CHECK (answered >= 1),
  pool_size      INTEGER NOT NULL CHECK (pool_size >= 1),
  created_at     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scores_board
  ON scores (mode, clip, scope, score DESC, accuracy DESC, avg_time ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_scores_royale
  ON scores (mode, clip, scope, max_combo DESC, score DESC, accuracy DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_scores_client
  ON scores (client_id, mode, clip, id DESC);
