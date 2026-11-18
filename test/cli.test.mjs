import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repo, makeVin, vehicle, observation, run } from "./helpers.mjs";

const exec = (script, args) => execFileSync(process.execPath, [script, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("the whole flow through a symlinked folder, as an installed skill runs it", () => {
  const dir = mkdtempSync(join(tmpdir(), "cs-"));
  const link = join(dir, "skill");
  symlinkSync(repo, link);
  const profile = join(link, "profiles", "example.json");
  const data = join(dir, "data");
  const vin = makeVin(7);
  const runFile = join(dir, "run.json");
  writeFileSync(runFile, JSON.stringify(run([observation(vin, { vehicle: vehicle("N1", { historyGrade: "clean" }), inventory: "listed", miles: 21000, quote: { price: 30000, doc: 200, basis: "dealer page" } })])));
  const base = ["--profile", profile, "--data", data];

  const dry = JSON.parse(exec(join(link, "scripts", "store.mjs"), ["add", ...base, "--run", runFile, "--dry-run"]));
  assert.equal(dry.newObservations, 1);
  assert.equal(JSON.parse(exec(join(link, "scripts", "store.mjs"), ["state", ...base])).length, 0);

  const added = JSON.parse(exec(join(link, "scripts", "store.mjs"), ["add", ...base, "--run", runFile]));
  assert.deepEqual(added.report.lines, ["N1 新车源：listed，估算落地 $32575"]);
  assert.equal(JSON.parse(exec(join(link, "scripts", "store.mjs"), ["add", ...base, "--run", runFile])).newObservations, 0);
  assert.equal(readFileSync(join(data, "observations.jsonl"), "utf8").trim().split("\n").length, 1);

  const check = JSON.parse(exec(join(link, "scripts", "store.mjs"), ["check", ...base, "--vin", vin]));
  assert.equal(check.known.id, "N1");
  assert.deepEqual(check.fitsModels, ["Sport Sedan"]);
  assert.equal(exec(join(link, "scripts", "store.mjs"), ["next-id", ...base, "--model", "Sport Sedan"]).trim(), "N2");
  assert.match(exec(join(link, "scripts", "rank.mjs"), [...base, "--date", "2030-01-10"]), /### 优先核价/);
  assert.match(exec(join(link, "scripts", "render.mjs"), ["snapshot", ...base]), /\| \[N1\]\(https:\/\/dealer\.example\/cars\/N1\)/);
  assert.equal(JSON.parse(exec(join(link, "scripts", "otd.mjs"), ["cap", "--profile", profile])).maxListPrice, 37176.47);
  assert.equal(JSON.parse(exec(join(link, "scripts", "vin.mjs"), [vin])).valid, true);
});

test("bad input exits non-zero with the reason", () => {
  const dir = mkdtempSync(join(tmpdir(), "cs-"));
  const runFile = join(dir, "run.json");
  writeFileSync(runFile, JSON.stringify(run([observation(makeVin(8), { inventory: "listed" })])));
  assert.throws(() => exec(join(repo, "scripts", "store.mjs"), ["add", "--profile", join(repo, "profiles", "example.json"), "--data", join(dir, "d"), "--run", runFile]), /first time seen/);
});
