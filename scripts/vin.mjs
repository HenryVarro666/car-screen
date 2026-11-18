#!/usr/bin/env node
// Check a VIN: shape, check digit, model year, and whether it fits a model in the profile.
//   node scripts/vin.mjs VIN [--profile profile.json] [--model "Model name"]
import { parseArgs, isMain, loadProfile, fail } from "../lib/cli.mjs";
import { inspect } from "../lib/vin.mjs";

if (isMain(import.meta)) {
  const args = parseArgs(process.argv.slice(2));
  if (!args._[0]) fail('Usage: vin.mjs VIN [--profile FILE] [--model "Model name"]', 2);
  if (!args.profile) {
    console.log(JSON.stringify(inspect(args._[0]), null, 2));
  } else {
    const profile = await loadProfile(args.profile);
    const models = args.model ? profile.models.filter((m) => m.name === args.model) : profile.models;
    if (!models.length) fail(`no model named ${args.model} in the profile`);
    const results = models.map((m) => ({ model: m.name, ...inspect(args._[0], m) }));
    console.log(JSON.stringify(results.length === 1 ? results[0] : { vin: results[0].vin, matches: results.filter((r) => r.matchesModel).map((r) => r.model), results }, null, 2));
  }
}
