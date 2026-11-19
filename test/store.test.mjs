import test from "node:test";
import assert from "node:assert/strict";
import { prepareRun, notable } from "../scripts/store.mjs";
import { currentState, changeFeed, soldArchive, nextId } from "../lib/state.mjs";
import { rankAll, todo } from "../lib/rank.mjs";
import { rankingMarkdown } from "../scripts/rank.mjs";
import { recordMarkdown } from "../scripts/render.mjs";
import { profile, makeVin, vehicle, observation, run } from "./helpers.mjs";

const [a, b, c, d] = [1, 2, 3, 4].map((n) => makeVin(n));

function apply(events, input) {
  const result = prepareRun(input, profile, events);
  return [...events, ...result.fresh.map((e, i) => ({ seq: events.length + i + 1, ...e }))];
}

test("a new VIN needs vehicle details, and the VIN must agree with the record", () => {
  assert.throws(() => prepareRun(run([observation(a, { inventory: "listed" })]), profile, []), /first time seen/);
  assert.throws(() => prepareRun(run([observation(a, { vehicle: vehicle("N1", { year: 2022 }) })]), profile, []), /disagrees with the VIN's model year 2023/);
  const coupe = makeVin(9, { body: "CM7" });
  assert.throws(() => prepareRun(run([observation(coupe, { vehicle: vehicle("N1") })]), profile, []), /rejected: coupe body/);
  const typo = a.slice(0, 16) + (a[16] === "1" ? "2" : "1");
  assert.throws(() => prepareRun(run([observation(typo, { vehicle: vehicle("N1") })]), profile, []), /check digit/);
});

test("ids are never reused and a VIN is never entered twice", () => {
  const events = apply([], run([observation(a, { vehicle: vehicle("N1"), inventory: "listed" })]));
  assert.throws(() => prepareRun(run([observation(b, { vehicle: vehicle("N1") })]), profile, events), /id N1 already belongs to/);
  assert.throws(() => prepareRun(run([observation(a, { vehicle: vehicle("N2") })]), profile, events), /already recorded as N1/);
  assert.equal(nextId(events, profile, "Sport Sedan"), "N2");
});

test("adding the same run twice stores nothing new", () => {
  const input = run([observation(a, { vehicle: vehicle("N1"), inventory: "listed", quote: { price: 30000, basis: "dealer page" } })]);
  const events = apply([], input);
  const again = prepareRun(input, profile, events);
  assert.equal(again.fresh.length, 0);
  assert.equal(again.count, 1);
});

test("sold cars leave the watch list for good", () => {
  let events = apply([], run([observation(a, { vehicle: vehicle("N1"), inventory: "listed" })]));
  events = apply(events, run([observation(a, { at: "2030-01-11T09:00", inventory: "sold" })], { completedAt: "2030-01-11T10:00" }));
  assert.ok(soldArchive(events).has(a));
  assert.throws(() => prepareRun(run([observation(a, { at: "2030-01-12T09:00", inventory: "listed" })], { completedAt: "2030-01-12T10:00" }), profile, events), /archived as sold/);
  assert.equal(currentState(events, profile)[0].closed, true);
});

test("an unverified read does not overwrite the last confirmed status", () => {
  let events = apply([], run([observation(a, { vehicle: vehicle("N1"), inventory: "listed", quote: { price: 30000, basis: "dealer page" } })]));
  events = apply(events, run([observation(a, { at: "2030-01-11T09:00", inventory: "unverified", note: "site returned 403" })], { completedAt: "2030-01-11T10:00" }));
  const [car] = currentState(events, profile);
  assert.equal(car.inventory.inventory, "unverified");
  assert.equal(car.confirmed.inventory, "listed");
  assert.equal(car.closed, false);
  assert.equal(car.quoteRecord.quote.otd, 32375);
});

const configuration = {
  level: "high",
  analysis: "The sport and driver assistance packages put this example above the base trim.",
  items: [
    { name: "Sport", detail: "Adaptive dampers", status: "present", evidence: "B", msrp: 2000 },
    { name: "Track edition", detail: "Not offered in this model year", status: "absent", evidence: "model" },
    { name: "Premium audio", detail: "The sticker is incomplete", status: "unknown" },
  ],
  msrp: { base: 50000, options: 2000, destination: 1000, total: 53100 },
};

test("a VIN configuration survives stock and quote updates without refreshing the listing date", () => {
  let events = apply([], run([
    observation(a, { vehicle: vehicle("N1"), inventory: "listed", quote: { price: 33000, basis: "listing" } }),
    observation(b, { vehicle: vehicle("N2"), inventory: "listed" }),
  ]));
  const input = run([observation(a, { at: "2030-01-11", configuration })],
    { job: "configuration", completedAt: "2030-01-11T10:00" });
  events = apply(events, input);
  let [saved] = currentState(events, profile);
  assert.equal(saved.last.at, "2030-01-10T09:00:00");
  assert.equal(saved.configuration.date, "2030-01-11");
  assert.equal(prepareRun(input, profile, events).fresh.length, 0);

  events = apply(events, run([observation(a, { at: "2030-01-12", inventory: "on_hold", quote: { price: 32000, basis: "listing" } })],
    { completedAt: "2030-01-12T10:00" }));
  const [car, other] = currentState(events, profile);
  assert.equal(car.inventory.inventory, "on_hold");
  assert.equal(car.quoteRecord.quote.price, 32000);
  assert.deepEqual(car.configuration, saved.configuration);
  assert.equal(other.configuration, undefined);
});

test("a seller listing cannot establish the absence of an option", () => {
  const absent = { ...configuration.items[1], evidence: "B" };
  assert.throws(() => prepareRun(run([observation(a, { configuration: { ...configuration, items: [absent] } })]),
    profile, []), /absence requires/);
});

test("configuration-only runs cannot change inventory", () => {
  const input = run([observation(a, { configuration, inventory: "available" })], { job: "configuration" });
  assert.throws(() => prepareRun(input, profile, []), /accept only configuration assessments/);
});

test("changes and the short report", () => {
  let events = apply([], run([observation(a, { vehicle: vehicle("N1"), inventory: "listed", quote: { price: 30000, basis: "dealer page" } })]));
  events = apply(events, run([
    observation(a, { at: "2030-01-11T09:00", inventory: "listed", quote: { price: 29000, basis: "dealer page" } }),
    observation(b, { at: "2030-01-11T09:05", vehicle: vehicle("N2"), inventory: "coming_soon" }),
  ], { completedAt: "2030-01-11T10:00" }));
  const feed = changeFeed(events, profile);
  assert.equal(feed.length, 3);
  assert.equal(feed[1].quoteChanged, true);
  assert.equal(feed[1].stockChanged, false);
  const report = notable(feed.slice(0, 2), currentState(events, profile));
  assert.deepEqual(report.lines, ["N2 新车源：coming_soon", "N1 价格 $30000 → $29000（落地 $31312.5）"]);
});

test("ranking: stage first, then proof, cost, mileage; eliminations stay visible", () => {
  const events = apply([], run([
    observation(a, { vehicle: vehicle("N1", { historyGrade: "clean" }), inventory: "listed", miles: 30000, quote: { price: 33000, basis: "p" }, options: { sportPackage: { value: "present", evidence: "B" }, appearancePackage: { value: "plus", evidence: "B" } } }),
    observation(b, { vehicle: vehicle("N2", { historyGrade: "clean" }), inventory: "listed", miles: 40000, quote: { price: 34000, basis: "p" }, options: { sportPackage: { value: "present", evidence: "A" }, appearancePackage: { value: "plus", evidence: "A" } } }),
    observation(c, { vehicle: vehicle("N3", { historyGrade: "damage" }), inventory: "listed", miles: 10000, quote: { price: 25000, basis: "p" } }),
    observation(d, { vehicle: vehicle("N4", { historyGrade: "clean" }), inventory: "listed", miles: 10000, quote: { price: 25000, basis: "p" }, options: { premiumAudio: { value: "absent", evidence: "A" } } }),
  ]));
  const vehicles = currentState(events, profile);
  const ranked = rankAll(vehicles, profile, "2030-01-10");
  assert.deepEqual(ranked.map((r) => r.car.id), ["N2", "N1", "N3", "N4"]);
  assert.deepEqual(ranked.map((r) => r.rec.stageLabel), ["优先核价", "优先核价", "风险暂缓", "已淘汰"]);
  const text = rankingMarkdown(vehicles, profile, "2030-01-10");
  assert.match(text, /\[N2 2023 Sedan N2\]\(https:\/\/dealer\.example\/cars\/N2\)/);
  assert.match(text, /### 已淘汰/);
  assert.match(text, /确认没有 Premium audio/);
});

test("over-budget and unpriced cars drop a stage", () => {
  const events = apply([], run([
    observation(a, { vehicle: vehicle("N1", { historyGrade: "clean" }), inventory: "listed", quote: { price: 45000, basis: "p" } }),
    observation(b, { vehicle: vehicle("N2", { historyGrade: "clean" }), inventory: "listed" }),
    observation(c, { vehicle: vehicle("N3"), inventory: "listed", quote: { price: 30000, basis: "p" } }),
    observation(d, { vehicle: vehicle("N4", { historyGrade: "clean" }), inventory: "on_hold", quote: { price: 30000, basis: "p" } }),
  ]));
  const stages = Object.fromEntries(rankAll(currentState(events, profile), profile, "2030-01-10").map((r) => [r.car.id, r.rec.stageLabel]));
  assert.deepEqual(stages, { N1: "超预算", N2: "先补证据", N3: "先补证据", N4: "等库存" });
});

test("todo lists what is still open and what was already tried", () => {
  const events = apply([], run([observation(a, {
    vehicle: vehicle("N1"), inventory: "listed", quote: { price: 30000, basis: "p", lowerBound: true },
    options: { sportPackage: { value: "present", evidence: "B" }, adaptiveSteering: { value: "present", evidence: "B" } },
    tried: [{ field: "premiumAudio", channel: "aggregator", result: "template text only" }],
  })]));
  const [car] = currentState(events, profile);
  const open = todo(car, profile);
  assert.deepEqual(open.map((t) => t.field), ["premiumAudio", "sportPackage", "appearancePackage", "history", "warranty", "quote"]);
  assert.equal(open[0].tried[0].channel, "aggregator");
  assert.match(open[1].upgrade, /窗贴/);
  const record = recordMarkdown(car, profile);
  assert.match(record, /^#### N1：2023 Sedan N1，Example Motors/);
  assert.match(record, /估算落地 \$32,375\.00 起/);
  assert.match(record, /Premium audio（已试 aggregator）/);
});

test("a field can name which values count as preferred", () => {
  const strict = structuredClone(profile);
  strict.fields.find((f) => f.key === "appearancePackage").preferred = ["plus"];
  const events = apply([], run([
    observation(a, { vehicle: vehicle("N1", { historyGrade: "clean" }), inventory: "listed", quote: { price: 30000, basis: "p" }, options: { sportPackage: { value: "present", evidence: "A" }, appearancePackage: { value: "standard", evidence: "A" } } }),
    observation(b, { vehicle: vehicle("N2", { historyGrade: "clean" }), inventory: "listed", quote: { price: 31000, basis: "p" }, options: { sportPackage: { value: "present", evidence: "A" }, appearancePackage: { value: "plus", evidence: "A" } } }),
  ]));
  const ranked = rankAll(currentState(events, strict), strict, "2030-01-10");
  assert.deepEqual(ranked.map((r) => r.car.id), ["N2", "N1"]);
  assert.equal(ranked[1].rec.config.rank, 2);
});

test("cars outside the current rules and stale confirmations leave the top of the ranking", () => {
  const old = makeVin(5, { year: "K" });
  // Entered back when the profile had no year limit.
  const looser = structuredClone(profile);
  delete looser.models[0].years;
  const result = prepareRun(run([
    observation(a, { vehicle: vehicle("N1", { historyGrade: "clean" }), inventory: "listed", quote: { price: 30000, basis: "p" } }),
    observation(old, { vehicle: vehicle("N2", { historyGrade: "clean", year: 2019 }), inventory: "listed", quote: { price: 20000, basis: "p" } }),
  ]), looser, []);
  const events = result.fresh.map((e, i) => ({ seq: i + 1, ...e }));
  const fresh = Object.fromEntries(rankAll(currentState(events, profile), profile, "2030-01-11").map((r) => [r.car.id, r.rec]));
  assert.equal(fresh.N1.stageLabel, "优先核价");
  assert.equal(fresh.N2.stageLabel, "规则外");
  assert.match(fresh.N2.reasons[0], /2019 款不在 2021/);
  const later = Object.fromEntries(rankAll(currentState(events, profile), profile, "2030-01-20").map((r) => [r.car.id, r.rec]));
  assert.equal(later.N1.stageLabel, "先补证据");
  assert.ok(later.N1.reasons.includes("状态已 10 天没复核"));
  assert.equal(later.N1.next[0], "复核库存和价格");
});
