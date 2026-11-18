// Ranking: which cars to act on first, and why. Reads structured fields only.
// Pure functions, usable in Node and in the browser.
import { fieldsFor, modelByName } from "./profile.mjs";
import { inspect } from "./vin.mjs";
import { IN_STOCK } from "./observation.mjs";

export const STAGES = ["优先核价", "先补证据", "等库存", "超预算", "风险暂缓", "已淘汰", "规则外", "已归档"];

function historyRank(car) {
  if (car.historyGrade === "damage" || car.priority === "risk") return { rank: 2, reason: "有事故、损伤或产权风险记录" };
  if (car.historyGrade === "clean") return { rank: 0, reason: "完整车史未报告事故或损伤" };
  if (car.historyGrade === "concern") return { rank: 1, reason: "车史有待复核事项" };
  return { rank: 1, reason: "完整车史还没读到" };
}

// How well the fields marked "rank" are proven. Lower is better.
function configRank(car, profile) {
  const fields = fieldsFor(profile, car.model).filter((f) => f.mode === "rank");
  if (!fields.length) return { rank: 0, reason: "", missing: [] };
  const states = fields.map((f) => ({ field: f, option: car.options?.[f.key] }));
  // A field may name the values that count as the preferred ones (e.g. only the "plus" package).
  const wanted = (s) => s.option && !["absent", "unknown"].includes(s.option.value) && (!s.field.preferred || s.field.preferred.includes(s.option.value));
  const present = states.filter(wanted);
  const missing = states.filter((s) => !s.option || s.option.value === "unknown").map((s) => s.field.label);
  const absent = states.filter((s) => s.option && s.option.value !== "unknown" && !wanted(s)).map((s) => s.field.label);
  if (present.length === fields.length) {
    const allA = present.every((s) => s.option.evidence === "A");
    return { rank: allA ? 0 : 1, reason: allA ? "偏好选装有同 VIN 窗贴证明" : "偏好选装来自卖家描述", missing };
  }
  const other = states.filter((s) => s.option && !["absent", "unknown"].includes(s.option.value) && !wanted(s)).map((s) => `${s.field.label} 为 ${s.option.value}`);
  const none = states.filter((s) => s.option?.value === "absent").map((s) => s.field.label);
  const parts = [present.length ? `有 ${present.map((s) => s.field.label).join("、")}` : "", ...other, none.length ? `无 ${none.join("、")}` : ""].filter(Boolean);
  if (present.length) return { rank: 2, reason: parts.join("，"), missing };
  if (parts.length) return { rank: 3, reason: parts.join("，"), missing };
  return { rank: 3, reason: absent.length === fields.length ? "偏好选装都没有" : "偏好选装待核", missing };
}

// Fields marked "eliminate": a proven absence removes the car from the ranking, visibly.
function eliminatedBy(car, profile) {
  return fieldsFor(profile, car.model)
    .filter((f) => f.mode === "eliminate" && car.options?.[f.key]?.value === "absent")
    .map((f) => f.label);
}

function priceTier(car, profile) {
  const quote = car.quoteRecord?.quote;
  if (!quote) return { tier: 2, reason: "还没读到价格", overBudget: false };
  const statusAt = car.confirmed?.at ?? "";
  const stale = car.quoteRecord.at.slice(0, 10) < statusAt.slice(0, 10);
  const worst = quote.otdMax ?? quote.otd;
  const overBudget = !stale && quote.otd > profile.budget.otdCap;
  if (stale) return { tier: 2, reason: "报价早于最近一次状态核对", overBudget, otd: quote.otd };
  if (quote.lowerBound) return { tier: 1, reason: "费用或运费待核，估算为起价", overBudget, otd: quote.otd };
  if (worst > profile.budget.otdCap && !overBudget) return { tier: 1, reason: "按运费上限估算会超预算", overBudget, otd: quote.otd };
  return { tier: 0, reason: "", overBudget, otd: quote.otd };
}

function warrantyRank(car, today) {
  if (!car.warrantyUntil) return { rank: 2, daysLeft: null, milesLeft: null };
  const daysLeft = Math.round((Date.parse(car.warrantyUntil) - Date.parse(today)) / 86_400_000);
  const milesLeft = car.warrantyMiles && car.miles !== undefined ? car.warrantyMiles - car.miles : null;
  const active = daysLeft > 0 && (milesLeft === null || milesLeft > 0);
  return { rank: active ? 0 : 1, daysLeft, milesLeft };
}

export function recommend(car, profile, today) {
  const status = car.confirmed?.inventory ?? car.inventory?.inventory ?? "unverified";
  const history = historyRank(car);
  const config = configRank(car, profile);
  const price = priceTier(car, profile);
  const warranty = warrantyRank(car, today);
  const eliminated = eliminatedBy(car, profile);
  const inStock = IN_STOCK.includes(status) || status === "auction";

  // Cars recorded under earlier rules stay on file but leave the ranking.
  const model = modelByName(profile, car.model);
  const fit = model ? inspect(car.vin, { ...model, years: undefined }) : { matchesModel: true, problems: [] };
  const years = model?.years ?? {};
  const outOfScope = [];
  if ((years.from && car.year < years.from) || (years.to && car.year > years.to)) outOfScope.push(`${car.year} 款不在 ${years.from ?? ""}–${years.to ?? ""} 范围`);
  if (!fit.matchesModel) outOfScope.push(...fit.problems.filter((p) => !p.startsWith("check digit")));

  // Stock and prices move within days; an old confirmation is a lead, not a fact.
  const staleDays = profile.staleDays ?? 3;
  const checkedAt = (car.confirmed?.at ?? car.last?.at ?? "").slice(0, 10);
  const age = checkedAt ? Math.round((Date.parse(today) - Date.parse(checkedAt)) / 86_400_000) : null;
  const stale = inStock && age !== null && age > staleDays;

  let stage;
  if (car.closed) stage = 7;
  else if (outOfScope.length) stage = 6;
  else if (eliminated.length) stage = 5;
  else if (history.rank === 2) stage = 4;
  else if (!inStock) stage = 2;
  else if (price.overBudget) stage = 3;
  else if (history.rank === 1 || price.tier === 2 || stale) stage = 1;
  else stage = 0;

  const reasons = [];
  if (outOfScope.length) reasons.push(...outOfScope);
  if (eliminated.length) reasons.push(`确认没有 ${eliminated.join("、")}`);
  if (stale) reasons.push(`状态已 ${age} 天没复核`);
  if (car.closed) reasons.push(status);
  else if (!inStock) reasons.push(`状态 ${status}`);
  reasons.push(history.reason);
  if (config.reason) reasons.push(config.reason);
  if (price.reason) reasons.push(price.reason);
  if (price.overBudget) reasons.push(`估算落地价超过上限 ${profile.budget.otdCap}`);

  const next = [];
  if (stale) next.push("复核库存和价格");
  if (history.rank === 1) next.push("读同 VIN 完整车史");
  if (config.missing.length) next.push(`核实 ${config.missing.join("、")}`);
  if (price.tier > 0 && !car.closed) next.push("要逐项落地报价");
  if (history.rank === 2) next.push("先拿维修工单并确认产权");

  return { stage, stageLabel: STAGES[stage], status, inStock, history, config, price, warranty, eliminated, outOfScope, stale, reasons, next };
}

const bucket = (value, size) => (value === undefined || value === null ? Number.MAX_SAFE_INTEGER : Math.floor(value / size));

// Order: stage, then proof of preferred options, then cost in $1,000 steps,
// mileage in 5,000-mile steps, remaining warranty, and finally the exact figures.
export function compare(a, b) {
  return (
    a.rec.stage - b.rec.stage ||
    a.rec.history.rank - b.rec.history.rank ||
    a.rec.config.rank - b.rec.config.rank ||
    a.rec.price.tier - b.rec.price.tier ||
    bucket(a.rec.price.otd, 1000) - bucket(b.rec.price.otd, 1000) ||
    bucket(a.car.miles, 5000) - bucket(b.car.miles, 5000) ||
    a.rec.warranty.rank - b.rec.warranty.rank ||
    (b.rec.warranty.daysLeft ?? -Infinity) - (a.rec.warranty.daysLeft ?? -Infinity) ||
    (a.rec.price.otd ?? Infinity) - (b.rec.price.otd ?? Infinity) ||
    (a.car.miles ?? Infinity) - (b.car.miles ?? Infinity) ||
    a.car.id.localeCompare(b.car.id, "en", { numeric: true })
  );
}

export function rankAll(vehicles, profile, today, { model } = {}) {
  return vehicles
    .filter((car) => !model || car.model === model)
    .map((car) => ({ car, rec: recommend(car, profile, today) }))
    .sort(compare);
}

// What is still unknown for a car, and which channels were already tried for it.
export function todo(car, profile) {
  const items = [];
  for (const field of fieldsFor(profile, car.model)) {
    // Record-only fields are shown when known and never chased.
    if (field.mode === "record") continue;
    const option = car.options?.[field.key];
    if (!option || option.value === "unknown") {
      items.push({ field: field.key, label: field.label, mode: field.mode, tried: car.tried.filter((t) => t.field === field.key) });
    } else if (option.evidence === "B") {
      items.push({ field: field.key, label: field.label, mode: field.mode, upgrade: "只有卖家描述，找同 VIN 窗贴", tried: car.tried.filter((t) => t.field === field.key) });
    }
  }
  if (!car.historyGrade || car.historyGrade === "unknown") items.push({ field: "history", label: "完整车史", tried: car.tried.filter((t) => t.field === "history") });
  if (!car.warrantyUntil) items.push({ field: "warranty", label: "按投入使用日算的保修到期日", tried: car.tried.filter((t) => t.field === "warranty") });
  if (car.quoteRecord?.quote?.lowerBound) items.push({ field: "quote", label: "费用分项和运费", tried: [] });
  return items;
}
