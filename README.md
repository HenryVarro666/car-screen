# car-screen

给 Claude Code 或 Codex 用的技能：按一份车型配置，在各二手车平台搜车、逐台核实、持续复核并排序。

读页面由 AI 用真实浏览器完成（多数车网站会挡脚本抓取）。VIN 校验、去重、落地价、月供和排序由 `scripts/` 里的脚本计算。数据是一个只追加的文件，每次看到什么就记一行。

它只读页面，不联系车商。

## 安装

需要 Node 18 或更新版本，没有其他依赖。测试里有一项（托管版看板）用到 Node 22.5 起自带的 SQLite，旧版本会自动跳过。

```sh
git clone https://github.com/HenryVarro666/car-screen.git ~/Documents/GitHub/car-screen
cd ~/Documents/GitHub/car-screen
./install.sh
node --test
```

`install.sh` 把仓库链接到 `~/.claude/skills/car-screen` 和 `~/.codex/skills/car-screen`（哪个文件夹存在就链哪个）。

## 配置

在你的工作目录里建 `.car-screen/profiles/<名字>.json`，从 `profiles/example.json` 复制后改：

- `models`：车型、编号前缀、年款范围、VIN 规则（必须匹配的、要挡掉的）
- `areas`、`destinations`：本地区域和送达邮编
- `budget`：落地价上限、首付、年利率、期数
- `tax`：税率和上牌预留
- `fields`：关注的选装。每个字段必须写 `mode`：
  - `eliminate` 确认没有就淘汰
  - `rank` 有更好，影响排序
  - `record` 只记录
- `channels`：要查的渠道和顺序

配置和数据都留在你自己的工作目录里，不进这个仓库。

## 怎么用

对 AI 说：

| 你说 | 它做 |
|---|---|
| 贴一条单车链接或 VIN，"调研一下这辆车" | 查重、车商页、选装、车史、保修、召回、落地价，写进记录 |
| "更新一下库存" | 复核在库的车，按渠道搜新车，只报告有变化的 |
| "重新排一下" | 生成带链接的排序表，写进笔记 |
| "预算提到 53000" / "某选装不要了" | 改配置（先确认是淘汰、排序还是只记录），重排 |

## 脚本

```sh
P=.car-screen/profiles/my.json; D=.car-screen/data

node scripts/vin.mjs <VIN> --profile $P                 # 校验位、年款、是否符合车型规则
node scripts/otd.mjs estimate --profile $P --price 30000 --doc 200
node scripts/otd.mjs cap --profile $P                   # 预算对应的车价上限
node scripts/store.mjs check --profile $P --data $D --vin <VIN>
node scripts/store.mjs add --profile $P --data $D --run run.json
node scripts/store.mjs todo --profile $P --data $D      # 每台车还差什么、哪些渠道试过了
node scripts/store.mjs changes --profile $P --data $D
node scripts/rank.mjs --profile $P --data $D --out ranking.md
node scripts/render.mjs record --profile $P --data $D --vin <VIN>
```

## 看板

`dashboard/` 是一个本地网页，读同一份数据：筛选、排序、并排比较、每台车的价格和库存历史。

```sh
node dashboard/serve.mjs --profile $P --data $D
```

然后打开 http://localhost:4173 ，点单车标题查看配置分析。配置卡按 VIN 保存，展示已配备、明确未配备、待核项目与配置档位的理由。排序支持正序和反序，按配置档位排序时，待判定始终排在最后。录入格式见 [记录格式](references/record-format.md#按-vin-保存配置分析)。部署到 Cloudflare Workers 的做法见 `dashboard/README.md`。

## 文件

```
SKILL.md                  技能入口
references/
  channels.md             各渠道怎么查、被挡时怎么记
  evidence-grades.md      选装证据 A/B/C 级
  record-format.md        run 文件、观察记录、笔记条目的格式
  pitfalls.md             踩过的坑
profiles/example.json     虚构的示例配置
lib/                      纯函数：VIN、落地价、校验、状态、排序（脚本和看板共用）
scripts/                  命令行
dashboard/                看板
test/                     node --test
```

## 说明

- 各网站的 URL 写法和限制是 2026 年 11 月在美国市场实测的，会变。
- 税的默认算法按德州写，其他州改配置。
- 排序的分档和理由按规则生成，不是购买建议。
