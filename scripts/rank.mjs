#!/usr/bin/env node
// Ranking table as Markdown, one table per model, every row linked to its listing.
//   node scripts/rank.mjs --profile P --data DIR [--model "Model name"] [--date YYYY-MM-DD] [--out FILE] [--json]
import { writeFile } from "node:fs/promises";
import { parseArgs, isMain, loadProfile, readEvents, today, fail } from "../lib/cli.mjs";
import { currentState } from "../lib/state.mjs";
import { rankAll, STAGES } from "../lib/rank.mjs";
import { money } from "../lib/otd.mjs";
import { fieldsFor } from "../lib/profile.mjs";

const cell = (text) => String(text ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");

function optionCell(car, field) {
  const option = car.options?.[field.key];
  if (!option || option.value === "unknown") return "待核";
  if (option.value === "absent") return "无（A）";
  return `${option.value === "present" ? "有" : option.value}（${option.evidence}）`;
}

export function rankingMarkdown(vehicles, profile, date) {
  const lines = [];
  for (const model of profile.models) {
    const ranked = rankAll(vehicles, profile, date, { model: model.name });
    if (!ranked.length) continue;
    const fields = fieldsFor(profile, model.name).filter((f) => f.mode !== "record");
    lines.push(`## ${model.name}`, "");
    lines.push(`落地价上限 ${money(profile.budget.otdCap, 0)}；首付 ${money(profile.budget.downPayment, 0)}、年利率 ${(profile.budget.apr * 100).toFixed(2)}%、${profile.budget.termMonths} 期。记录日期 ${date}。`, "");
    for (const [index, label] of STAGES.entries()) {
      const group = ranked.filter((r) => r.rec.stage === index);
      if (!group.length) continue;
      lines.push(`### ${label}`, "");
      lines.push(`| 名次 | 车 | 状态 | 里程 | 车价 | 估算落地 | 月供 | 距上限 | ${fields.map((f) => cell(f.label)).join(" | ")}${fields.length ? " | " : ""}为什么排这里 | 下一步 |`);
      lines.push(`|---:|---|---|---:|---:|---:|---:|---:|${fields.map(() => "---|").join("")}---|---|`);
      group.forEach(({ car, rec }, i) => {
        const quote = car.quoteRecord?.quote;
        const link = car.listing ?? car.last?.url;
        const name = `${car.id} ${car.year} ${car.title}`;
        const otd = quote ? money(quote.otd) + (quote.lowerBound ? " 起" : "") : "待核";
        lines.push(`| ${i + 1} | ${link ? `[${cell(name)}](${link})` : cell(name)} | ${rec.status}（${cell(car.confirmed?.at ?? car.last?.at ?? "")}） | ${car.miles !== undefined ? car.miles.toLocaleString("en-US") + (car.approximateMiles ? " 约" : "") : "待核"} | ${quote ? money(quote.price, 0) : "待核"} | ${otd} | ${quote ? money(quote.monthly) : ""} | ${quote ? money(profile.budget.otdCap - quote.otd, 0) : ""} | ${fields.map((f) => optionCell(car, f)).join(" | ")}${fields.length ? " | " : ""}${cell(rec.reasons.join("；"))} | ${cell(rec.next.join("；"))} |`);
      });
      lines.push("");
    }
  }
  if (!lines.length) lines.push("没有可排序的车。");
  return lines.join("\n") + "\n";
}

if (isMain(import.meta)) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const profile = await loadProfile(args.profile);
    if (!args.data) fail("--data DIR is required");
    const date = args.date ?? today(profile.timezone);
    let vehicles = currentState(await readEvents(args.data), profile);
    if (args.model) vehicles = vehicles.filter((v) => v.model === args.model);
    if (args.json) {
      console.log(JSON.stringify(rankAll(vehicles, profile, date).map(({ car, rec }) => ({ id: car.id, vin: car.vin, stage: rec.stageLabel, reasons: rec.reasons, next: rec.next, otd: rec.price.otd })), null, 2));
    } else {
      const text = rankingMarkdown(vehicles, profile, date);
      if (args.out) { await writeFile(args.out, text); console.error(`written to ${args.out}`); }
      else process.stdout.write(text);
    }
  } catch (error) {
    fail(`error: ${error.message}`);
  }
}
