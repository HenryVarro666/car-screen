#!/usr/bin/env node
// The append-only record of what was seen, one line per observation.
//
//   node scripts/store.mjs add    --profile P --data DIR --run run.json [--dry-run] [--reopen]
//   node scripts/store.mjs check  --profile P --data DIR --vin VIN
//   node scripts/store.mjs state  --profile P --data DIR [--vin VIN]
//   node scripts/store.mjs todo   --profile P --data DIR [--vin VIN] [--all]
//   node scripts/store.mjs changes --profile P --data DIR [--vin VIN] [--limit N]
//   node scripts/store.mjs next-id --profile P --data DIR --model "Model name"
//
// DIR holds observations.jsonl. Earlier lines are never rewritten.
import { readFile } from "node:fs/promises";
import { parseArgs, isMain, loadProfile, readEvents, appendEvents, sha256, fail } from "../lib/cli.mjs";
import { normalizeRun, InputError, IN_STOCK } from "../lib/observation.mjs";
import { currentState, changeFeed, soldArchive, nextId } from "../lib/state.mjs";
import { inspect } from "../lib/vin.mjs";
import { todo } from "../lib/rank.mjs";
import { modelByName } from "../lib/profile.mjs";

// reopen: accept observations for VINs archived as sold (a sale recorded by mistake, or imported history).
export function prepareRun(input, profile, existing, { reopen = false } = {}) {
  const run = normalizeRun(input, profile);
  const sold = soldArchive(existing);
  const known = new Map();
  for (const event of existing) if (event.data.vehicle) known.set(event.data.vin, event.data.vehicle);
  const seenIds = new Set(existing.map((e) => e.id));
  const usedCarIds = new Map(existing.filter((e) => e.data.vehicle).map((e) => [e.data.vehicle.id, e.data.vin]));
  const problems = [];
  const fresh = [];
  const inRun = new Set();

  for (const data of run.observations) {
    const model = modelByName(profile, data.vehicle?.model ?? known.get(data.vin)?.model);
    const vinCheck = inspect(data.vin, data.vehicle ? model : undefined);
    if (!vinCheck.valid) problems.push(`${data.vin}: ${vinCheck.problems.join("; ")}`);
    if (data.vehicle && vinCheck.modelYear && data.vehicle.year !== vinCheck.modelYear) {
      problems.push(`${data.vin}: vehicle.year ${data.vehicle.year} disagrees with the VIN's model year ${vinCheck.modelYear}`);
    }
    if (!reopen && sold.has(data.vin) && data.inventory !== "sold") {
      problems.push(`${data.vin}: already archived as sold; it is not tracked any more (pass --reopen if the sale was recorded by mistake)`);
    }
    if (!known.has(data.vin) && !data.vehicle) problems.push(`${data.vin}: first time seen, so the observation needs vehicle details`);
    if (data.vehicle) {
      const owner = usedCarIds.get(data.vehicle.id);
      if (owner && owner !== data.vin) problems.push(`${data.vin}: id ${data.vehicle.id} already belongs to ${owner}; ids are never reused`);
      const earlier = known.get(data.vin);
      if (earlier && earlier.id !== data.vehicle.id) problems.push(`${data.vin}: already recorded as ${earlier.id}; do not enter the same VIN as a new car`);
      usedCarIds.set(data.vehicle.id, data.vin);
      known.set(data.vin, data.vehicle);
    }
    if (data.options && !data.vehicle) {
      // Options were validated without a model; recheck against the model on record.
      const modelName = known.get(data.vin)?.model;
      for (const key of Object.keys(data.options)) {
        const field = profile.fields.find((f) => f.key === key);
        if (modelName && field?.models && !field.models.includes(modelName)) problems.push(`${data.vin}: options.${key} does not apply to ${modelName}`);
      }
    }
    const id = sha256(run.job + "\n" + JSON.stringify(data));
    if (inRun.has(id)) problems.push(`${data.vin}: the same observation appears twice in this run`);
    inRun.add(id);
    if (!seenIds.has(id)) fresh.push({ id, job: run.job, data });
  }
  if (problems.length) throw new InputError(problems.join("\n"));
  const runId = sha256(JSON.stringify([run.job, run.completedAt, run.partial, [...inRun].sort()]));
  for (const event of fresh) event.run = runId;
  return { runId, job: run.job, completedAt: run.completedAt, partial: run.partial, count: run.observations.length, fresh };
}

// At most five lines a person would act on: new cars, price moves, status moves.
export function notable(changes, vehicles, limit = 5) {
  const idOf = (vin) => vehicles.find((v) => v.vin === vin)?.id ?? vin;
  const lines = [];
  for (const c of changes) {
    const id = idOf(c.vin);
    if (c.firstSeen) lines.push(`${id} 新车源：${c.inventory ?? "状态未记"}${c.quote ? `，估算落地 $${c.quote.otd}${c.quote.lowerBound ? " 起" : ""}` : ""}`);
    else if (c.quoteChanged && c.previousQuote && c.quote && c.previousQuote.price !== c.quote.price) lines.push(`${id} 价格 $${c.previousQuote.price} → $${c.quote.price}（落地 $${c.quote.otd}${c.quote.lowerBound ? " 起" : ""}）`);
    else if (c.stockChanged && c.inventory !== "unverified") lines.push(`${id} 状态 ${c.previousStatus ?? "无"} → ${c.inventory}`);
    else if (c.arrivalChanged) lines.push(`${id} 到店时间 ${c.arrival}`);
  }
  return { lines: lines.slice(0, limit), more: Math.max(lines.length - limit, 0) };
}

if (isMain(import.meta)) {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0];
  const modes = ["add", "check", "state", "todo", "changes", "next-id"];
  if (!modes.includes(mode)) fail(`Usage: store.mjs ${modes.join("|")} --profile FILE --data DIR ...`, 2);
  try {
    const profile = await loadProfile(args.profile);
    if (!args.data) fail("--data DIR is required");
    const events = await readEvents(args.data);

    if (mode === "add") {
      if (!args.run) fail("--run FILE is required");
      const result = prepareRun(JSON.parse(await readFile(args.run, "utf8")), profile, events, { reopen: Boolean(args.reopen) });
      const withSeq = result.fresh.map((e, i) => ({ seq: events.length + i + 1, ...e }));
      const after = [...events, ...withSeq];
      const vehicles = currentState(after, profile);
      const newSeqs = new Set(withSeq.map((e) => e.seq));
      const changes = changeFeed(after, profile, { limit: 10_000 }).filter((c) => newSeqs.has(c.seq));
      if (!args["dry-run"]) await appendEvents(args.data, result.fresh);
      console.log(JSON.stringify({
        runId: result.runId, job: result.job, partial: result.partial, count: result.count,
        newObservations: result.fresh.length, dryRun: Boolean(args["dry-run"]),
        report: notable(changes, vehicles),
      }, null, 2));
    } else if (mode === "check") {
      if (!args.vin) fail("--vin is required");
      const vin = String(args.vin).toUpperCase();
      const car = currentState(events, profile).find((v) => v.vin === vin);
      const fits = profile.models.map((m) => ({ model: m.name, ...inspect(vin, m) }));
      console.log(JSON.stringify({
        vin, checkDigitOk: inspect(vin).valid, modelYear: inspect(vin).modelYear,
        fitsModels: fits.filter((f) => f.matchesModel).map((f) => f.model),
        whyNot: Object.fromEntries(fits.filter((f) => !f.matchesModel).map((f) => [f.model, f.problems])),
        known: car ? { id: car.id, status: car.confirmed?.inventory ?? car.inventory?.inventory, lastSeen: car.last?.at } : null,
        archivedSold: soldArchive(events).has(vin),
      }, null, 2));
    } else if (mode === "state") {
      let vehicles = currentState(events, profile);
      if (args.vin) vehicles = vehicles.filter((v) => v.vin === String(args.vin).toUpperCase());
      console.log(JSON.stringify(vehicles, null, 2));
    } else if (mode === "todo") {
      let vehicles = currentState(events, profile).filter((v) => !v.closed);
      if (args.vin) vehicles = vehicles.filter((v) => v.vin === String(args.vin).toUpperCase());
      else if (!args.all) vehicles = vehicles.filter((v) => IN_STOCK.includes(v.confirmed?.inventory) || v.confirmed?.inventory === "auction");
      const out = vehicles.map((v) => ({ id: v.id, vin: v.vin, open: todo(v, profile) })).filter((v) => v.open.length);
      console.log(JSON.stringify(out, null, 2));
    } else if (mode === "changes") {
      console.log(JSON.stringify(changeFeed(events, profile, { vin: args.vin ? String(args.vin).toUpperCase() : undefined, limit: args.limit ? Number(args.limit) : 16 }), null, 2));
    } else {
      const id = nextId(events, profile, args.model);
      if (!id) fail(`no model named ${args.model} in the profile`);
      console.log(id);
    }
  } catch (error) {
    fail(`error: ${error.message}`);
  }
}
