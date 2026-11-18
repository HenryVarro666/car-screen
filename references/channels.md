# 各渠道怎么查

2026 年 11 月在美国市场实测。网站会改版，URL 写法失效时以实际页面为准，并回来更新这页。

通用规则：纯文本抓取工具经常只拿到空壳或被挡，动态页面用真实浏览器。直接用搜索引擎搜 VIN 基本没结果，不用试。

## 搜索入口

| 渠道 | 怎么搜 | 能回答什么 | 已知问题 |
|---|---|---|---|
| CarMax | 列表页 `carmax.com/cars/<品牌>/<车型>/<版本>`；单车 `carmax.com/car/<库存号>`；车史 `.../car/<库存号>/vehicle-history` | 全国库存、能否调车、调车费和到店时间、AutoCheck、Vehicle Label | 见下文"CarMax 的坑" |
| CarGurus | `cargurus.com/search?zip=<邮编>&distance=<英里>&sortType=DEAL_SCORE&startYear=<年>&makeModelTrimPaths=<路径>`；每个目的地邮编各查一次 | 按 deal 评级排序的线索、可配送车的运费 | 纯文本工具打不开；评级标签记日期和邮编 |
| Cars.com | `cars.com/shopping/<品牌-车型>/<城市-州>/`，或带 `models[]=`、`zip=`、半径的搜索 | 线索、AutoCheck 入口 | 版本筛选参数可能返回 0，改为不筛版本后人工挑；列表是虚拟滚动，要边滚边收；有反爬验证，浏览器里等几秒会自动过，要点击的验证不代点 |
| Autotrader | `autotrader.com/cars-for-sale/<品牌>/<车型>/<版本>/<城市-州>` | 线索 | 旧链接常跳转 |
| 车商官网 | 用 VIN 在站内搜，或打开同 VIN 单车页 | 状态、价格、费用分项、窗贴 | 旧式带哈希的单车链接经常失效，失效时回库存列表或站内 VIN 搜索找；有些站返回 403 或 5xx |
| 金融机构的购车页（如 Capital One） | 按 VIN 的单车详情页 | 是否仍在挂牌 | 返回 410 表示已下架 |
| KBB、J.D. Power、Edmunds 等 | 按 VIN 或城市 | 线索 | 常见 403；内容多为模板 |

线索的意思是：只用来发现车。价格、状态、配置都要回到同 VIN 的车商页或原始文件核对。

## 核实入口

| 要核什么 | 去哪 | 备注 |
|---|---|---|
| 选装 | 车商官网的 Window Sticker / Vehicle Documents；CarMax 的 Vehicle Label；厂家配置表 | 见 `evidence-grades.md` |
| 车史 | 完整 CARFAX（`carfax.com/vehicle/<VIN>` 或车商给的报告链接）、AutoCheck | 常有验证墙；摘要不算完整车史 |
| 车身、年款、发动机 | NHTSA vPIC：`vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/<VIN>?format=json` | 和 `vin.mjs` 的结果互相印证 |
| 召回 | `nhtsa.gov/recalls?vymm=<VIN>`，或 NHTSA recalls API | 厂家自己的召回查询有时返回 503 |
| 保修起算日 | 厂家按 VIN 的保养或保修查询 | 各品牌入口不同，写进配置的 `channels`；查不到就写"起算日未知" |
| 税费规则 | 所在州税务部门的页面 | 税率和计税口径写进配置 |

## CarMax 的坑

- **目的地门店**：不设门店时，抓取工具会落到一个默认邮编，返回的调车费和到店时间都是那个地方的。在浏览器里先把门店设成配置里的目的地，再读调车信息。
- **车在哪**：页面上有"你的门店"和"车所在门店"两个字段，别读反。
- **状态用词**：列表里的 Available 可能是 Available soon。以单车页为准。
- **功能描述**：模板文字里的词不等于选装。例如 "acoustic" 可能指泊车雷达提示音。
- **Vehicle Label**：是带临时令牌的 PDF。浏览器内置查看器常显示空白，令牌会过期。能下载就下载后用 `pdftotext` 读；读不到就请用户另存 PDF 给你。读不到时记"待核"，并在 `tried` 里记一笔。
- **数量**：搜索结果的数量随门店和筛选变，不要写"全国只有 N 台"。

## 被挡时怎么记

| 情况 | 记法 |
|---|---|
| 403、429、5xx、超时 | `inventory: "unverified"`，`note` 写状态码和时间 |
| 登录墙、验证码 | 同上，写"需要验证" |
| 页面跳转到库存列表 | `unverified`，写"单车页跳转" |
| 搜索结果里没有这台车 | `unverified`，写"搜索未见"。不记 `sold` |
| 官网单车页写 Sold | `sold` |
| 金融机构购车页返回 410，且车商站内搜不到 | `unavailable` |
| 缓存和实时页冲突 | 以实时页为准，`note` 里写明冲突 |

同一台车在不同来源、不同时区看到的价格差，先核对是不是同一天、同一口径，再判断是不是调价。
