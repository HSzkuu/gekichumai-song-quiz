# 迁移到 Cloudflare Workers 指南

> 目标：把当前的 **Node.js 单进程服务**（静态站 + SQLite 排行榜 + `ws` 房间）
> 迁到 **Cloudflare Workers + Workers Assets + D1 + Durable Objects**。
>
> 这是一份迁移说明，不是一键部署脚本。现有的 `node server.mjs` 仍可继续使用；
> 建议先在本地把 Worker 跑通，再切正式域名。

## 0. 结论先行

推荐按下面三层拆：

| 层 | 现在 | 迁移后 |
|---|---|---|
| 静态站 | `server.mjs` 的静态文件服务 | **Workers Assets**，目录 `public/` |
| 排行榜 | `node:sqlite` + `data/leaderboard.sqlite` | **D1**，SQL 基本不变 |
| 联机房间 | `ws` + 内存 `Map` | **Durable Object**（先单实例 `RoomHub`） |

第一阶段不要急着做「一房一个 DO」。当前客户端协议是：

```text
连接 /ws → 发 identify → room:create / room:join → 收 room:state / game:*
```

房间码不是在 WebSocket URL 里，而是在连接后的消息里。这和「一房一个 DO」
不兼容。所以：

- **阶段 A（推荐先做）**：一个全局 `RoomHub` DO 管所有房间，协议、客户端都不改。
- **阶段 B（流量大了再做）**：改成 `/ws?room=CODE`，一房一个 DO，房间列表单独放
  D1 或一个 Lobby DO，客户端创建/加入房间也要改成先走 HTTP。

单 DO 对 100 个房间 / 800 个 WebSocket 的粉丝向项目通常够用；它的瓶颈是单实例
CPU 和连接数，不是 D1。

```text
Browser
  ├─ GET /, /assets/* ───────→ Worker ─→ env.ASSETS.fetch()
  ├─ GET/POST /api/leaderboard → Worker ─→ D1
  └─ wss://.../ws ───────────→ Worker ─→ RoomHub Durable Object ─→ 内存房间
```

---

## 1. 前置条件

- Node.js 20+（本地构建；现有服务需要 22.5+ 才能跑 `node:sqlite`）
- Cloudflare 账号
- Wrangler（建议用项目本地 devDependency，避免全局版本漂移）
- 已开通 D1 和 Durable Objects（免费额度/付费情况以 Cloudflare 当前控制台为准）
- 音源仍在 LXNS CDN，不需要迁到 R2：
  `https://assets2.lxns.net/maimai/music/{id}.mp3`

```bash
npm i -D wrangler
npx wrangler login
```

---

## 2. 静态资源构建

仓库里已经加了 `tools/build-cf.mjs`，执行：

```bash
npm run build:cf
```

它会生成：

```text
public/
├── index.html
└── assets/
    ├── css/style.css
    ├── js/*.js
    ├── fonts/*
    └── img/*

worker/catalog.json   # 从 assets/js/data.js 抽出的服务端曲库
```

`public/`、`worker/catalog.json` 都是构建产物，已加入 `.gitignore`，不要提交。
每次改了曲库（`npm run sync`）或前端后，重新执行 `npm run build:cf` 再部署。

`worker/catalog.json` 是给 Worker / DO 用的，不是给浏览器用的；浏览器仍加载
`public/assets/js/data.js`。

---

## 3. D1 排行榜

### 3.1 建库

```bash
npx wrangler d1 create mai-quiz
```

把输出里的 `database_id` 填到 `wrangler.toml`（从
[`wrangler.toml.example`](../wrangler.toml.example) 复制）。

### 3.2 建表

**不要用 `db/schema.sql` 直接导 D1**：它有一行 Node 侧使用的
`PRAGMA journal_mode = WAL;`。D1 内部已经用 WAL，这行没有意义，部分环境会报错。

用专门给 D1 的 schema：

```bash
npx wrangler d1 execute mai-quiz --remote --file=db/schema.d1.sql
# 本地开发库
npx wrangler d1 execute mai-quiz --local  --file=db/schema.d1.sql
```

`db/schema.d1.sql` 和 `db/schema.sql` 的表结构、索引完全一致，只去掉了 PRAGMA。
`AUTOINCREMENT`、`CHECK`、`ROW_NUMBER()` 窗口函数 D1 都支持。

### 3.3 API 适配

当前 `server.mjs` 用的是同步 `node:sqlite`：

```js
const row = db.prepare(sql).get(...params);
const all = db.prepare(sql).all(...params);
const info = db.prepare(insertSql).run(...params);
const id = Number(info.lastInsertRowid);
```

D1 是异步的：

```js
const row = await env.DB.prepare(sql).bind(...params).first();
const { results } = await env.DB.prepare(sql).bind(...params).all();
const info = await env.DB.prepare(insertSql).bind(...params).run();
const id = Number(info.meta.last_row_id);
```

对应关系：

| Node | D1 |
|---|---|
| `db.prepare(sql).get()` | `env.DB.prepare(sql).bind(...).first()` |
| `db.prepare(sql).all()` | `env.DB.prepare(sql).bind(...).all()` → `results` |
| `.run()` | `.run()` → `meta.last_row_id` / `meta.changes` |
| `lastInsertRowid` | `meta.last_row_id` |
| 同步 `try/catch` | 全部 `await`，外层 try/catch |
| `PRAGMA ...` | D1 不需要 |

注意：

- D1 的 prepared statement **不要放在模块顶层复用**，在每次请求里 `prepare` 即可
  （D1 自身会缓存查询计划）。
- `queryBoard()` 里的 `LIMIT ?`、`OFFSET` 不需要改；参数顺序保持原样。
- `COUNT(DISTINCT client_id)`、`ROW_NUMBER()` 都可直接用。
- 写入后马上读排名时，D1 是强一致读（同一主库），不需要 sleep；但不要并发
  `run()` + `first()` 依赖返回顺序，必要时用 `batch()`。

`worker/api.js` 的骨架：

```js
export async function handleApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/api/health') {
    const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM scores').first();
    return Response.json({ ok: true, records: Number(row?.total || 0) });
  }
  // GET /api/leaderboard → 复用 server.mjs 的 queryBoard SQL
  // POST /api/leaderboard → 复用 validateSubmission()，再 env.DB.prepare(...).run()
}
```

`validateSubmission()`、`sanitizeCn()`、CORS 头、32 KB 请求体限制都可以直接从
`server.mjs` 复制；它们不依赖 Node API，只依赖 `Response` / `Request`。

---

## 4. Worker 入口

```js
// worker/index.js
import { handleApi } from './api.js';

export { RoomHub } from './room-hub.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      const id = env.ROOMS.idFromName('global');
      return env.ROOMS.get(id).fetch(request);
    }

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
```

`wrangler.toml` 用 [`wrangler.toml.example`](../wrangler.toml.example)：

- `run_worker_first = true`：所有请求先进 Worker，Worker 再决定 `/api`、`/ws` 或
  静态资源；否则 `/api/*` 可能被 Assets 先接走，永远到不了 Worker。
- `binding = "ASSETS"` 对应 `env.ASSETS.fetch(request)`。
- D1 binding 叫 `DB`。
- DO binding 叫 `ROOMS`，类名 `RoomHub`。

---

## 5. Durable Object：房间

### 5.1 先保持单实例，不拆房间

新建 `worker/room-hub.js`，把 `server/rooms.mjs` 里的房间逻辑搬进去。核心是
替换 I/O，不要重写状态机：

| `server/rooms.mjs` | Worker / DO |
|---|---|
| `new WebSocketServer({ server, path: '/ws' })` | `RoomHub.fetch()` 里 `WebSocketPair` |
| `ws.on('close', ...)` | `server.addEventListener('close', ...)` |
| `ws.send(JSON.stringify(obj))` | `server.send(JSON.stringify(obj))`，先判断 `readyState === 1` |
| `WebSocket.OPEN` | `1`（或使用平台常量） |
| `ws.meta` / `sockets` | DO 内存里的 `this.sockets` / `conn.meta` |
| `server.listen` | `export default { fetch }` |
| `process.env` | `env` |

非休眠版骨架：

```js
// worker/room-hub.js（示意）
import catalogJson from './catalog.json';

const CATALOG = {
  ...catalogJson,
  catKeys: new Set(catalogJson.catKeys),
};

export class RoomHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.catalog = CATALOG;
    this.rooms = new Map();     // 复用 rooms.mjs 的 room 结构
    this.sockets = new Set();
    this.playerSeq = 0;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const conn = {
      ws: server,
      meta: { clientId: null, cn: null, roomCode: null, playerId: null },
      send(payload) {
        if (server.readyState === 1) server.send(JSON.stringify(payload));
      },
    };
    this.sockets.add(conn);

    server.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      if (event.data.length > 16 * 1024) { server.close(1009, 'too large'); return; }
      this.handleMessage(conn, event.data); // 从 rooms.mjs 搬过来的 switch
    });
    server.addEventListener('close', () => {
      this.sockets.delete(conn);
      this.handleLeave(conn, true);         // 保留 5 分钟座位
    });
    server.addEventListener('error', () => {
      this.sockets.delete(conn);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // 这里放 rooms.mjs 的 handleMessage / broadcastRoom / startQuestion /
  // finishQuestion / joinRoom / kickPlayer 等，改成 class 方法。
}
```

需要特别处理的点：

1. **`ws` 对象**：Worker 的 WebSocket 没有 Node `ws` 的 `.on()` 链式 API；
   用 `addEventListener`。房间逻辑里如果用了 `ws.on('close')`，要统一换成
   `close` 监听；客户端主动离开走 `room:leave`。
2. **`wsSend`**：`rooms.mjs` 顶部集中改一次即可；不要在几十个地方分别判断。
3. **`WebSocket.OPEN`**：DO 环境里别依赖 `ws` 包常量，用 `readyState === 1`。
4. **`maxPayload`**：Worker 没有 `maxPayload` 选项，手动判断消息长度。
5. **`server.accept()` vs `state.acceptWebSocket()`**：
   - 先用 `server.accept()`（非休眠），代码最接近 Node，`setTimeout` 也能用；
   - 想要 DO 休眠省费，改用 `state.acceptWebSocket(server)` +
     `webSocketMessage()` / `webSocketClose()`，并用 `serializeAttachment()` 保存
     `clientId / cn / roomCode / playerId`。这会改变连接生命周期，建议第二阶段再做。
6. **房间列表**：单 DO 内 `broadcastRoomList()` 直接遍历 `this.rooms`；不需要 D1。
7. **房间定时器**：`setTimeout` 在非休眠 DO 里可用，但有 WebSocket 的 DO 被驱逐时
   会丢。正式环境建议把：
   - `readyTimer`
   - `deadlineTimer`
   - `earlyTimer`
   - `revealTimer`
   - `betTimer`
   - `startTimer`
   - `disconnectTimer`（5 分钟重连保留）

   改成 `state.storage.setAlarm(nextAt)` + `alarm()`，房间状态存 DO storage 或在
   alarm 里重建。至少要把「断线 5 分钟后再移除」和「答题截止」放到 alarm，
   否则 DO 被回收后房间会卡死。
8. **单实例上限**：一个 DO 只有一个实例，所有房间的 WebSocket 都进它。100 房 ×
   8 人 = 800 连接对 DO 不算大，但消息风暴、出题计算、广播都在同一个实例；
   监控 `duration` / `cpuTime`，大了再拆房。

### 5.2 第二阶段：一房一个 DO

如果以后要拆：

1. `POST /api/rooms` 创建房间码，写 D1 的 `rooms` 表（或 Lobby DO），返回
   `{ code, wsUrl }`。
2. Worker 路由 `/ws?room=CODE`，用 `env.ROOMS.idFromName(code)` 取对应 DO。
3. 每个 `RoomDO` 只保存一个房间，`room:list` 由 Lobby DO / D1 提供。
4. 客户端 `connectMulti()` 需要改成「先 HTTP create/join，再连 WS」；现在客户端是
   先连 `/ws` 再发消息，不能直接复用。
5. 房间链接仍然是 `?room=CODE`，但真正连接时要带 `?room=CODE` 到 WS URL。

这是一次协议升级，不是纯后端搬迁；没有并发压力前不建议先做。

---

## 6. 客户端配置

同域部署时，前端不用改：

- `assets/js/config.js` 的 `leaderboardApi: ''` → 同源 `/api/leaderboard`
- `app.js` 的 WebSocket 地址是 `new URL('/ws', location.href)` → 同源 `wss://`
- 房间链接 `?room=CODE` 仍在同一域名下

如果静态放 Cloudflare Pages、API 放 Workers（不同域），在 `config.js` 填完整地址：

```js
window.MAI_CONFIG = {
  leaderboardApi: 'https://xxx.workers.dev/api/leaderboard',
  multiplayerWs: 'wss://xxx.workers.dev/ws',
};
```

同时 Worker 的 CORS 要允许实际页面域名，不要继续用 `*`（如果以后加凭证）。
本项目的排行榜是匿名的，`*` 也能跑，但不推荐长期这样。

---

## 7. 本地开发与部署

### 7.1 本地

```bash
npm run build:cf
npx wrangler d1 execute mai-quiz --local --file=db/schema.d1.sql
npx wrangler dev
```

打开 Wrangler 输出的 `http://localhost:8787`。重点测：

- `/api/health`
- 排行榜 GET / POST
- 创建房间、2 人加入、开始、答题、结算
- 断线重连（关闭标签/刷新/断网恢复）
- 押注阶段、超时自动押 20%、筹码归零淘汰
- 踢人、公开/私人切换
- 移动端

### 7.2 生产

```bash
npm run build:cf
npx wrangler d1 execute mai-quiz --remote --file=db/schema.d1.sql
npx wrangler deploy
```

绑定自定义域名后，首次验证：

```bash
curl https://你的域名/api/health
```

健康检查返回 `{"ok":true,...}` 后再看 WebSocket 和房间列表。

> 注意：`wrangler deploy` 不会自动执行 D1 schema；第一次部署前必须先执行
> `db/schema.d1.sql`，否则 `/api/health` 会报表不存在。

---

## 8. 曲库更新

```bash
npm run sync
npm run build:cf
npx wrangler deploy
```

`assets/js/data.js` 变了以后，`worker/catalog.json` 必须一起重建；否则 Worker 里
还是旧曲库。`worker/catalog.json` 已 gitignore，不要提交。

---

## 9. 已有 SQLite 数据迁移（可选）

当前 `data/leaderboard.sqlite` 是运行时文件，不进 Git。如果线上已经有一些成绩，
可以导出成 INSERT 再灌 D1。因为本仓库当前测试库是空的，通常可以跳过。

思路：

```bash
# 1. 只导出数据，不要导出 PRAGMA / BEGIN / COMMIT
sqlite3 data/leaderboard.sqlite \
  "SELECT id, client_id, cn, mode, clip, question_count, scope, score, accuracy, avg_time, max_combo, correct, answered, pool_size, created_at FROM scores;" \
  > /tmp/scores.tsv

# 2. 用脚本生成 INSERT INTO scores (...) VALUES (...); 的 SQL
# 3. npx wrangler d1 execute mai-quiz --remote --file=/tmp/scores-insert.sql
```

注意：

- `id` 可以保留；D1 的 `AUTOINCREMENT` 会接着用。
- 不要直接用 `sqlite3 .dump`，里面包含 D1 不接受的 `PRAGMA` / 事务控制；
  先清理再导入。
- 导入前备份；导入后查 `SELECT COUNT(*) FROM scores` 核对。

---

## 10. 安全、限制与成本

- **排行榜没有登录**：`clientId` 是浏览器生成的，换 localStorage 就能换身份。
  公网运营建议加 Turnstile、Workers Rate Limiting、或要求登录。
- **提交频率**：当前 Node 版有 3.5 秒的客户端提交间隔校验；迁移后保留。
- **WebSocket 限流**：`rooms.mjs` 有 30 条/秒的简单限制；DO 里继续保留。
- **房间上限**：8 人/房、100 房；单 DO 时所有房间共享一个实例。
- **D1 写入**：排行榜每次提交一次 INSERT；D1 免费额度足够粉丝向使用，但写入
  有速率限制，避免被刷。
- **D1 查询**：排行榜使用覆盖索引；不要每次 `SELECT *`。
- **DO 费用**：WebSocket 连接时长、请求、CPU 都计费；具体以 Cloudflare 当前
  价格页为准。休眠 WebSocket 能显著省费，但需要 `acceptWebSocket` + alarms。
- **音源版权**：音频仍然来自 LXNS CDN，不随 Worker 一起分发；不要上传音频文件
  到仓库或 R2 公开桶，除非你确认授权。

---

## 11. 验收清单

- [ ] `npm run build:cf` 生成 `public/` 和 `worker/catalog.json`
- [ ] D1 已建库，`db/schema.d1.sql` 已导入
- [ ] `/api/health` 返回 `ok: true`
- [ ] 排行榜 GET 分页/筛选/scope 正常；POST 后 rank 正常
- [ ] `/ws` 能升级；创建/加入房间正常
- [ ] 房间列表公开/私人切换正确
- [ ] 2–8 人同题、同音频、同倒计时
- [ ] 断线 5 分钟内重连回原座位；超时移除
- [ ] 押注阶段先线索后猜歌、只能押自己、0 筹码淘汰
- [ ] 房主踢人；被踢者无法重进同一房
- [ ] 手机端 4 列玩家状态、房间列表、下注界面
- [ ] 刷新/房间链接 `?room=CODE` 正常
- [ ] 自定义域名 + HTTPS（WSS 自动）
- [ ] 旧 Node 服务保留可回滚

---

## 12. 回滚

迁移期间保留 `node server.mjs` 和 `data/leaderboard.sqlite`。如果 Worker 出问题：

1. 把域名指回原来的 Node 服务；
2. 排行榜新数据在 D1；如需回到 SQLite，用第 9 节反向导出；
3. 房间是内存态，切回后房间会清空，这是正常行为。

---

## 13. 相关文件

- [`db/schema.d1.sql`](../db/schema.d1.sql)：D1 建表
- [`wrangler.toml.example`](../wrangler.toml.example)：Wrangler 配置模板
- [`tools/build-cf.mjs`](../tools/build-cf.mjs)：静态目录 + 曲库构建
- [`docs/github-publish.md`](./github-publish.md)：上传 GitHub
- [`server.mjs`](../server.mjs)：现有 Node 版 API
- [`server/rooms.mjs`](../server/rooms.mjs)：现有房间状态机（迁移时主要参考）
