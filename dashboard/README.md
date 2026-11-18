# 看板

同一份观察数据的网页视图：按车型分表、筛选、排序、并排比较三台车、每台车的价格和库存历史、最近的变化。

## 本地运行

```sh
node dashboard/serve.mjs --profile <配置文件> --data <数据目录>
```

打开 http://localhost:4173 。只监听本机，只读。每次刷新都重新读配置和数据，所以 `store.mjs add` 之后刷新页面就能看到。

## 部署到 Cloudflare Workers

这条路径的代码有本地测试（`test/dashboard.test.mjs` 用本地 SQLite 模拟 D1），没有在真实的 Cloudflare 账号上跑过。第一次部署时按下面的步骤走，遇到出入以 Cloudflare 文档为准。

```sh
cd dashboard
cp wrangler.example.toml wrangler.toml
cp <你的配置文件> profile.json          # 两个文件都被 .gitignore 排除

npx wrangler d1 create car-screen        # 把返回的 database_id 填进 wrangler.toml
npx wrangler d1 execute car-screen --remote --file schema.sql
npx wrangler secret put VIEW_PASSWORD    # 打开网页时要输入的密码（用户名随意）
npx wrangler secret put SYNC_TOKEN       # 上传数据用的令牌
npx wrangler deploy
```

上传数据：

```sh
CAR_SCREEN_SYNC_TOKEN=<令牌> node dashboard/sync.mjs --data <数据目录> --url https://<你的 worker 地址>
```

可以反复执行，服务端每条观察只存一份。

说明：

- 没设 `VIEW_PASSWORD` 时，网页和接口一律拒绝访问。数据里有 VIN、预算和车商往来，不要公开。
- 服务端只检查上传内容的形状，规则校验在本地 `store.mjs add` 时已经做过。所以令牌要保密。
- 改了配置（预算、选装字段）要重新 `cp` 配置并 `wrangler deploy`。
