/* ============================================================
 * 部署配置（可选）
 * ------------------------------------------------------------
 * leaderboardApi 留空时使用同源的 /api/leaderboard，即随附的
 * node server.mjs（或 Worker 同域路由）。如果静态站与 API 分开
 * 部署，可填完整地址，例如：
 *   window.MAI_CONFIG = { leaderboardApi: 'https://xxx.workers.dev/api/leaderboard' };
 * ============================================================ */
window.MAI_CONFIG = {
  leaderboardApi: '',
};
