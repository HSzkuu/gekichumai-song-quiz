# 上传到 GitHub

> 目标：把当前项目干净地推到 GitHub，不把数据库、依赖、Wrangler 本地状态和
> 构建产物一起提交。Cloudflare 部署步骤见
> [`docs/cloudflare-workers-migration.md`](./cloudflare-workers-migration.md)。

## 1. 上传前检查

仓库已经有一个 `.gitignore`，会忽略：

```text
node_modules/
data/*.sqlite
data/*.sqlite-*
data/*.db
.DS_Store
.wrangler/
.dev.vars
.env
.env.*
public/
dist/
worker/catalog.json
```

确认这些文件**不要**进仓库：

- `node_modules/`：依赖，靠 `package-lock.json` 还原
- `data/leaderboard.sqlite*`：运行时成绩库
- `.wrangler/`：本地 D1 / DO 调试状态
- `.dev.vars` / `.env*`：本地密钥
- `public/`、`worker/catalog.json`：`npm run build:cf` 生成的构建产物

可以先检查：

```bash
git status --short --ignored
```

如果看到数据库或 `.dev.vars` 没被忽略，先补 `.gitignore` 再提交。

## 2. 本地初始化并提交

当前目录还没有 Git 仓库时：

```bash
cd /home/shizkuu/gekichumai-song-battle

git init
git add .
git commit -m "chore: initial import of maimai song quiz"
git branch -M main
```

提交前看一眼实际会进仓库的文件：

```bash
git status --short
git diff --cached --stat
```

特别检查：

- 没有 `data/*.sqlite*`
- 没有 `node_modules/`
- 没有 `.dev.vars` / `.env`
- 没有 `public/` 或 `worker/catalog.json`
- `index.html`、`assets/`、`server.mjs`、`docs/` 都在

## 3. 在 GitHub 建仓库

### 方式 A：网页创建

1. 打开 <https://github.com/new>
2. Repository name 例如 `maimai-song-quiz`
3. 不要勾选 “Add a README file / .gitignore / license”（本地已经有文件）
4. 创建后复制仓库地址，例如：
   `git@github.com:你的用户名/maimai-song-quiz.git`
   或
   `https://github.com/你的用户名/maimai-song-quiz.git`

然后：

```bash
git remote add origin git@github.com:你的用户名/maimai-song-quiz.git
# 如果没配 SSH，用 HTTPS：
# git remote add origin https://github.com/你的用户名/maimai-song-quiz.git

git push -u origin main
```

### 方式 B：GitHub CLI

已登录 `gh` 的话：

```bash
gh auth status
gh repo create maimai-song-quiz --public --source=. --remote=origin --push
```

想建私有仓库把 `--public` 换成 `--private`。

## 4. 如果仓库已经有内容

如果 GitHub 上已经初始化了 README，直接 push 可能被拒绝。先拉再推：

```bash
git remote add origin git@github.com:你的用户名/maimai-song-quiz.git
git fetch origin
git rebase origin/main
git push -u origin main
```

如果本地是第一次提交，也可以：

```bash
git pull --rebase origin main
git push -u origin main
```

不要用 `git push --force` 覆盖远程已有历史，除非你明确知道自己在做什么。

## 5. GitHub Pages 能不能直接用？

**不能完整使用。**

- 纯静态页面（首页、单人模式、排行榜界面）可以放 GitHub Pages；
- 但 `/api/leaderboard` 和 `/ws` 需要 Node 或 Cloudflare Worker；
- GitHub Pages 不执行 `server.mjs`，也没有 WebSocket 服务。

所以：

- **推荐**：GitHub 只存代码，部署到 Cloudflare Workers；
- 如果坚持用 Pages 做静态展示，需要把 `assets/js/config.js` 的
  `leaderboardApi` 和 `multiplayerWs` 指向一个独立部署的 Worker，并处理 CORS。
  此时联机/排行榜仍然是 Worker 在跑，不是 Pages。

## 6. 可选：GitHub Actions 自动部署 Cloudflare

如果不想每次本地 `wrangler deploy`，可以加一个 workflow。先在 GitHub 仓库
Settings → Secrets and variables → Actions 添加：

- `CLOUDFLARE_API_TOKEN`：Cloudflare API Token（Workers Scripts / D1 / Durable Objects 权限）
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Account ID

然后创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy Cloudflare Worker

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build:cf
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

注意：

- `wrangler.toml` 里的 D1 `database_id` 不是密钥，可以提交；但不要把 API Token
  写进仓库。
- 第一次部署前仍需手动执行一次 `db/schema.d1.sql`，workflow 不负责建表。
- `public/` 和 `worker/catalog.json` 在 CI 里由 `npm run build:cf` 生成，不需要提交。

## 7. 音频、曲绘与版权

- 音频/曲绘由浏览器直接从 LXNS CDN 读取，仓库里**没有**音频文件；
- `assets/js/data.js` 只有曲目元数据，不是音频；
- 不要为了让 GitHub Actions 构建通过而把整首音频或曲绘打包进仓库；
- README 已注明非官方粉丝作品；如权利人要求，停止分发相关资源。

## 8. 建议的仓库设置

- Description：`舞萌听歌大作战 — maimai listening quiz with solo / multiplayer / betting modes`
- Topics：`maimai`、`rhythm-game`、`quiz`、`cloudflare-workers`、`d1`、`durable-objects`
- 如果公开，加一个 LICENSE（例如 MIT），但注意 `assets/fonts/`、曲目元数据和
  SEGA / LXNS 相关内容的权利归属；不确定时可以先不加快照式许可证，只在 README
  声明“仅供学习交流”。
- 开启 Dependabot（可选）。

## 9. 之后更新

```bash
git add .
git commit -m "feat: ..."
git push
```

如果同时改了曲库：

```bash
npm run sync
npm run build:cf
# 本地验证后
git add assets/js/data.js
git commit -m "data: sync maimai catalog"
git push
```

`worker/catalog.json` 是构建产物，不提交；部署时在 CI 或本地重新生成。
