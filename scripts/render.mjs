#!/usr/bin/env node
// Markdown blocks to paste into notes.
//   node scripts/render.mjs record   --profile P --data DIR --vin VIN     one car's record
//   node scripts/render.mjs snapshot --profile P --data DIR [--job NAME]  table of cars touched by the latest run
import { parseArgs, isMain, loadProfile, readEvents, fail } from "../lib/cli.mjs";
import { currentState } from "../lib/state.mjs";
import { todo } from "../lib/rank.mjs";
import { money } from "../lib/otd.mjs";
import { fieldsFor } from "../lib/profile.mjs";

function optionLine(car, profile) {
  return fieldsFor(profile, car.model).map((f) => {
    const o = car.options?.[f.key];
    if (!o || o.value === "unknown") return `${f.label} 待核`;
    return `${f.label} ${o.value === "absent" ? "无" : o.value === "present" ? "有" : o.value}（${o.evidence} 级，${o.at}）`;
  }).join("；");
}

export function recordMarkdown(car, profile) {
  const quote = car.quoteRecord?.quote;
  const status = car.confirmed ?? car.inventory ?? car.last;
  const lines = [`#### ${car.id}：${car.year} ${car.title}，${car.dealer}`];
  lines.push(`- **${status.at} 状态记录：**VIN \`${car.vin}\`${car.stock ? `，Stock ${car.stock}` : ""}，${car.city}；${status.inventory ?? "状态未记"}${car.miles !== undefined ? `，${car.miles.toLocaleString("en-US")} mi${car.approximateMiles ? "（约）" : ""}` : ""}${quote ? `，${money(quote.price, 0)}${quote.doc ? `＋doc ${money(quote.doc, 0)}` : ""}` : ""}。${status.note ?? ""} [${status.source}](${status.url})`);
  if (fieldsFor(profile, car.model).length) lines.push(`- **配置：**${optionLine(car, profile)}。`);
  lines.push(`- **车史：**${car.history ?? "完整车史待核。"}`);
  const warranty = car.warrantyUntil ? `保修至 ${car.warrantyUntil}${car.warrantyMiles ? ` 或 ${car.warrantyMiles.toLocaleString("en-US")} mi` : ""}。` : (car.warranty ?? "保修起算日未知。");
  lines.push(`- **保障与费用：**${warranty}${quote ? ` 估算落地 ${money(quote.otd)}${quote.lowerBound ? " 起" : ""}，${profile.budget.termMonths} 期月供 ${money(quote.monthly)}${quote.lowerBound ? " 起" : ""}。${quote.feeNote ?? ""}` : " 报价待核。"}`);
  const open = todo(car, profile).map((t) => t.label + (t.tried.length ? `（已试 ${t.tried.map((x) => x.channel).join("、")}）` : ""));
  if (open.length || car.next) lines.push(`- **待办：**${[car.next, ...open].filter(Boolean).join("；")}。`);
  return lines.join("\n") + "\n";
}

export function snapshotMarkdown(vehicles, profile) {
  const rows = vehicles.map((car) => {
    const quote = car.quoteRecord?.quote;
    const status = car.inventory ?? car.last;
    const gaps = todo(car, profile).map((t) => t.label).join("、") || "无";
    return `| [${car.id}](${car.listing ?? status.url}) | \`${car.vin}\` | ${status.inventory ?? ""}（${status.at}） | ${quote ? money(quote.price, 0) : "待核"}${car.miles !== undefined ? `，${car.miles.toLocaleString("en-US")} mi` : ""} | ${quote ? money(quote.otd) + (quote.lowerBound ? " 起" : "") + "，月供 " + money(quote.monthly) : "待核"} | ${gaps} |`;
  });
  return ["| 车辆 | VIN | 本轮状态 | 当前价格与里程 | 同口径估算 | 还差什么 |", "|---|---|---|---|---|---|", ...rows].join("\n") + "\n";
}

if (isMain(import.meta)) {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0];
  if (!["record", "snapshot"].includes(mode)) fail("Usage: render.mjs record --vin VIN | snapshot [--job NAME]  (with --profile FILE --data DIR)", 2);
  try {
    const profile = await loadProfile(args.profile);
    if (!args.data) fail("--data DIR is required");
    const events = await readEvents(args.data);
    const vehicles = currentState(events, profile);
    if (mode === "record") {
      const car = vehicles.find((v) => v.vin === String(args.vin ?? "").toUpperCase());
      if (!car) fail("that VIN is not on record");
      process.stdout.write(recordMarkdown(car, profile));
    } else {
      const candidates = events.filter((e) => !args.job || e.job === args.job);
      const lastRun = candidates.at(-1)?.run;
      const touched = new Set(candidates.filter((e) => e.run === lastRun).map((e) => e.data.vin));
      process.stdout.write(snapshotMarkdown(vehicles.filter((v) => touched.has(v.vin)), profile));
    }
  } catch (error) {
    fail(`error: ${error.message}`);
  }
}
