import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareRun } from "../lib/run.mjs";
import { appendEvents } from "../lib/cli.mjs";
import { buildInventory, buildHistory } from "../dashboard/api.mjs";
import { createApp } from "../dashboard/serve.mjs";
import { repo, profile, makeVin, vehicle, observation, run } from "./helpers.mjs";

const [a, b] = [makeVin(21), makeVin(22)];
const first = prepareRun(run([
  observation(a, { vehicle: vehicle("N1", { historyGrade: "clean" }), inventory: "listed", miles: 20000, quote: { price: 30000, basis: "dealer page" }, options: { sportPackage: { value: "present", evidence: "A" } } }),
  observation(b, { vehicle: vehicle("N2", { historyGrade: "damage" }), inventory: "auction", auction: { status: "live", highBid: 21000, ends: "2030-01-12T14:00", reserve: true } }),
]), profile, []);
const events = first.fresh.map((e, i) => ({ seq: i + 1, ...e }));
const second = prepareRun(run([observation(a, { at: "2030-01-11T09:00", inventory: "listed", quote: { price: 29500, basis: "dealer page" } })], { completedAt: "2030-01-11T10:00" }), profile, events);
events.push(...second.fresh.map((e, i) => ({ seq: events.length + i + 1, ...e })));

test("inventory view: ranked cars, public profile, change feed", () => {
  const view = buildInventory(events, profile, "2030-01-11");
  assert.deepEqual(view.vehicles.map((v) => [v.id, v.rec.stageLabel]), [["N1", "优先核价"], ["N2", "风险暂缓"]]);
  assert.equal(view.vehicles[0].quoteRecord.quote.price, 29500);
  assert.equal(view.vehicles[1].auction.highBid, 21000);
  assert.equal(view.profile.models[0].vin, undefined, "search rules stay out of the page payload");
  assert.equal(view.profile.channels, undefined);
  assert.equal(view.changes[0].id, "N1");
  assert.equal(view.changes[0].previousQuote.price, 30000);
  const history = buildHistory(events, profile, a);
  assert.equal(history.observations.length, 2);
  assert.equal(buildHistory(events, profile, "nope"), null);
});

test("local server: api, static files, read only, no path escape", async () => {
  const dir = mkdtempSync(join(tmpdir(), "csd-"));
  await appendEvents(dir, [...first.fresh, ...second.fresh]);
  const server = createServer(createApp({ profilePath: join(repo, "profiles", "example.json"), dataDir: dir, now: () => "2030-01-11" }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const inventory = await (await fetch(base + "/api/inventory")).json();
    assert.equal(inventory.vehicles.length, 2);
    assert.equal((await fetch(base + "/api/history?vin=" + a)).status, 200);
    assert.equal((await fetch(base + "/api/history")).status, 400);
    const page = await fetch(base + "/");
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(await page.text(), /<script type="module" src="app\.js">/);
    assert.equal((await fetch(base + "/app.js")).status, 200);
    assert.equal((await fetch(base + "/styles.css")).status, 200);
    assert.equal((await fetch(base + "/..%2Fserve.mjs")).status, 404);
    assert.equal((await fetch(base + "/api/inventory", { method: "POST" })).status, 405);
  } finally {
    server.close();
  }
});

// A stand-in for D1 on top of Node's built-in SQLite.
async function fakeD1() {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync } = await import("node:fs");
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(repo, "dashboard", "schema.sql"), "utf8"));
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => statement(sql), batch: async (list) => Promise.all(list.map((s) => s.run())) };
}

test("worker: fails closed, password for reading, token for syncing, idempotent sync", async (t) => {
  let sqlite = true;
  try { await import("node:sqlite"); } catch { sqlite = false; }
  if (!sqlite) return t.skip("node:sqlite is not available in this Node version");
  const bundled = join(repo, "dashboard", "profile.json");
  const created = !existsSync(bundled);
  if (created) copyFileSync(join(repo, "profiles", "example.json"), bundled);
  try {
    const worker = (await import("../dashboard/worker.mjs")).default;
    const env = { DB: await fakeD1(), VIEW_PASSWORD: "open-sesame", SYNC_TOKEN: "t0ken", ASSETS: { fetch: async () => new Response("<html>", { headers: { "content-type": "text/html" } }) } };
    const basic = { authorization: "Basic " + btoa("me:open-sesame") };
    const call = (path, init = {}, e = env) => worker.fetch(new Request("https://example.test" + path, init), e);

    assert.equal((await call("/", {}, { ...env, VIEW_PASSWORD: undefined })).status, 503);
    assert.equal((await call("/api/inventory")).status, 401);
    assert.equal((await call("/api/inventory", { headers: { authorization: "Basic " + btoa("me:wrong") } })).status, 401);
    assert.equal((await call("/", { headers: basic })).status, 200);

    const payload = JSON.stringify({ events: events.map(({ id, job, run, data }) => ({ id, job, run, data })) });
    const post = (token, body = payload) => call("/api/sync", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body });
    assert.equal((await post("wrong")).status, 401);
    assert.equal((await post("t0ken", JSON.stringify({ events: [{ id: "x" }] }))).status, 400);
    assert.deepEqual(await (await post("t0ken")).json(), { received: 3, added: 3, total: 3 });
    assert.deepEqual(await (await post("t0ken")).json(), { received: 3, added: 0, total: 3 });

    const inventory = await (await call("/api/inventory", { headers: basic })).json();
    assert.deepEqual(inventory.vehicles.map((v) => v.id).sort(), ["N1", "N2"]);
    assert.equal((await call("/api/history?vin=" + a, { headers: basic })).status, 200);
    assert.equal((await call("/api/inventory", { method: "DELETE", headers: basic })).status, 405);
  } finally {
    if (created) unlinkSync(bundled);
  }
});
