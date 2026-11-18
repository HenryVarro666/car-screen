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
import { parseArgs, isMain, loadProfile, readEvents, appendEvents, fail } from "../lib/cli.mjs";
import { IN_STOCK } from "../lib/observation.mjs";
import { prepareRun, notable } from "../lib/run.mjs";
import { currentState, changeFeed, soldArchive, nextId } from "../lib/state.mjs";
import { inspect } from "../lib/vin.mjs";
import { todo } from "../lib/rank.mjs";

export { prepareRun, notable };

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
