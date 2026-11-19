# 记录格式

## run 文件

一次搜索或复核产生一个 run 文件，交给 `store.mjs add`。

```json
{
  "job": "manual",
  "completedAt": "2030-01-10T10:00",
  "partial": false,
  "observations": [ ... ]
}
```

- `job`：这次是什么任务。`manual`（用户点名查的）、`patrol`（整轮巡查），或单车跟踪用 `car-<库存号>`。小写字母、数字和短横线。
- `completedAt`：完成时间，配置时区的当地时间。
- `partial`：有渠道没查完就填 `true`。空的 run 必须是 `true`。

同一个 run 文件重复提交不会产生重复记录。

## 一条观察

```json
{
  "vin": "<17 位 VIN>",
  "at": "2030-01-10T09:42",
  "source": "车商官网同 VIN 单车页",
  "url": "https://dealer.example/inventory/vehicle/?vehicleId=<VIN>",
  "inventory": "available",
  "miles": 21450,
  "approximateMiles": false,
  "quote": {
    "price": 30500,
    "doc": 200,
    "basis": "官网单车页，本地自提",
    "lowerBound": true,
    "feeNote": "doc 费按页面明细；其他费用未列"
  },
  "options": { "sportPackage": { "value": "present", "evidence": "A" } },
  "tried": [ { "field": "premiumAudio", "channel": "aggregator", "result": "只有模板文字" } ],
  "note": "页首价格和明细一致。",
  "vehicle": { ... }
}
```

| 字段 | 说明 |
|---|---|
| `vin`、`at`、`source`、`url` | 必填。`url` 必须是 https，指向这次实际读的页面 |
| `inventory` | `available`、`transferable`（可调车）、`listed`（第三方平台在挂）、`on_hold`、`coming_soon`、`unavailable`、`sold`、`unverified`、`private_lead`（私人卖家线索）、`auction` |
| `miles`、`approximateMiles` | 页面只给约数时 `approximateMiles: true` |
| `quote` | 见下 |
| `options`、`tried` | 见 `evidence-grades.md` |
| `configuration` | 按 VIN 保存的配置分析。可以单独录入，见下节 |
| `arrival` | 只有 `transferable` 能带，写到店时间 |
| `auction` | 只有 `inventory: "auction"` 能带：`status`、`highBid`、`ends`、`reserve`、`salePrice` |
| `note` | 650 字以内。`unverified` 必须写明被什么挡住 |
| `vehicle` | 第一次见到这个 VIN 时必填；之后只在资料有更新时带 |

脚本会拒绝的组合：`unverified` 带报价；`sold` 或 `unavailable` 带报价；已售归档的 VIN 再出现（除非仍是 `sold`）；VIN 校验位不对；`vehicle.year` 和 VIN 的年款位不一致；编号被另一台车用过；同一个 VIN 换了编号。

## 按 VIN 保存配置分析

把 `configuration` 放在带 `vin`、`at`、`source` 和 `url` 的观察里。已收录的 VIN 可用 `job: "configuration"` 单独写入，同一车型的后续库存观察继续复用。新 VIN 也可和首次收录的 `vehicle` 一起写入。`store.mjs check` 返回 `known.configurationDate`，`state --vin` 读出分析。

```json
{
  "level": "high",
  "analysis": "同年款已证实有运动悬挂与驾驶辅助包，配置偏高。",
  "items": [
    { "name": "Sport Package", "status": "present", "detail": "同 VIN 车商列出运动悬挂。", "evidence": "B", "msrp": 2000 },
    { "name": "Track Edition", "status": "absent", "detail": "同市场的订车指南显示本年款没有该版本。", "evidence": "model" },
    { "name": "Premium Audio", "status": "unknown", "detail": "等同 VIN 的原厂窗贴或音响铭牌。" }
  ],
  "msrp": { "base": 50000, "options": 2000, "destination": 1000, "total": 53000 }
}
```

- `level` 可为 `high`、`mid`、`base` 或 `unknown`。`analysis` 用于说明与同年款同版本比较的依据。
- `present` 接受 A、B 或 `model` 级证据。`absent` 要有完整同 VIN 原厂资料（A），或能证明同市场年款不提供该配置的原厂资料（`model`）。资料没写的项目用 `unknown`，不填等级。
- 配置和单项都可附 HTTPS `url`。`msrp` 可省略，列出时记录资料中的各项金额，网页会显示加总差额。

## quote

| 字段 | 说明 |
|---|---|
| `price` | 车价。必填 |
| `basis` | 这个价格是什么、从哪读的。必填 |
| `priceLabel` | 配置里 `priceLabels` 之一。价格含费用时用它标明 |
| `doc` | 文件费，不计税 |
| `extraTaxable`、`extraNonTaxable` | 其他计税和不计税费用 |
| `transport`、`destination` | 运费和目的地，要一起填 |
| `transportMax` | 运费有区间时填上限 |
| `transportTaxable` | 运费是否计税（车商代收的调车费通常计税） |
| `lowerBound` | 还有费用或运费没核清时填 `true` |
| `feeNote` | 费用说明 |

估算：（车价 + 计税费用）×（1 + 税率）+ 上牌预留 + 不计税费用。税率和预留在配置里。已经含在总价里的费用只算一次。

## vehicle

必填：`id`、`model`、`year`、`title`、`dealer`、`city`、`area`、`priority`。

| 字段 | 说明 |
|---|---|
| `id` | 配置里该车型的前缀加序号，用 `store.mjs next-id` 取。一经分配不改 |
| `model` | 配置里的车型名 |
| `area` | 配置里的地区键，或 `outside` |
| `priority` | `watch`（用户点名关注）、`main`、`wait`、`risk` |
| `stock`、`color`、`paint`、`listing`、`links`、`sellerType`、`generation` | 可选 |
| `history`、`historyGrade` | 车史文字和分级：`clean`、`concern`、`damage`、`unknown` |
| `warranty`、`warrantyUntil`、`warrantyMiles` | 保修文字说明；到期日和里程上限只在有 VIN 依据时填 |
| `risk`、`next`、`target`、`highlight` | 风险、下一步、目标价、亮点 |
| `specs` | 自由的"标签: 文字"对，最多 12 项，放音响、悬挂这类描述 |

## 笔记里的单车条目

`render.mjs record` 生成这样的块，并进笔记：

```markdown
#### N12：2023 <车型>，<车商>
- **2030-01-10 状态记录：**VIN `<VIN>`，Stock <库存号>，<城市>；available，21,450 mi，$30,500＋doc $200。<备注> [来源](<链接>)
- **配置：**Sport package 有（A 级，2030-01-10）；Adaptive steering 待核。
- **车史：**<时间线摘要>
- **保障与费用：**保修至 2031-08-31 或 50,000 mi。估算落地 $33,106.25 起，60 期月供 $485.26 起。
- **待办：**<还差什么>
```

之后每次复核，在这台车的条目下追加一行带日期的状态记录。旧行不改不删。价格因为补算费用而变化时写明"计算补齐，不是调价"。
