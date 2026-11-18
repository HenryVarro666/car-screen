#!/usr/bin/env node
// Out-the-door estimate, monthly payment and list-price cap, using the profile's tax and loan terms.
//   node scripts/otd.mjs estimate --profile P --price 40997 [--doc 220] [--extra-taxable N] [--extra-nontaxable N]
//                                 [--transport N] [--transport-max N] [--transport-taxable] [--lower-bound]
//   node scripts/otd.mjs payment  --profile P --otd 60000
//   node scripts/otd.mjs cap      --profile P [--otd-cap N] [--extra-taxable N] [--extra-nontaxable N]
import { parseArgs, isMain, loadProfile, fail } from "../lib/cli.mjs";
import { estimate, monthlyPayment, maxListPrice } from "../lib/otd.mjs";

const num = (value, name) => {
  const n = Number(String(value).replace(/[$,]/g, ""));
  if (!Number.isFinite(n)) fail(`${name} is not a number: ${value}`);
  return n;
};

if (isMain(import.meta)) {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0];
  if (!["estimate", "payment", "cap"].includes(mode)) fail("Usage: otd.mjs estimate|payment|cap --profile FILE ...", 2);
  const profile = await loadProfile(args.profile);
  const opt = (flag) => (args[flag] === undefined ? undefined : num(args[flag], flag));
  if (mode === "estimate") {
    if (!args.price) fail("--price is required");
    const quote = {
      price: num(args.price, "price"), doc: opt("doc"), extraTaxable: opt("extra-taxable"), extraNonTaxable: opt("extra-nontaxable"),
      transport: opt("transport"), transportMax: opt("transport-max"), transportTaxable: Boolean(args["transport-taxable"]), lowerBound: Boolean(args["lower-bound"]),
    };
    const result = estimate(quote, profile.tax);
    console.log(JSON.stringify({
      ...result,
      monthly: monthlyPayment(result.otd, profile.budget),
      overCap: result.otd > profile.budget.otdCap,
      toCap: Math.round((profile.budget.otdCap - result.otd) * 100) / 100,
      note: result.lowerBound ? "fees or shipping still open: treat as a floor" : undefined,
    }, null, 2));
  } else if (mode === "payment") {
    if (!args.otd) fail("--otd is required");
    console.log(JSON.stringify({ monthly: monthlyPayment(num(args.otd, "otd"), profile.budget), ...profile.budget }, null, 2));
  } else {
    const cap = opt("otd-cap") ?? profile.budget.otdCap;
    console.log(JSON.stringify({ otdCap: cap, maxListPrice: maxListPrice(cap, profile.tax, { extraTaxable: opt("extra-taxable") ?? 0, extraNonTaxable: opt("extra-nontaxable") ?? 0 }) }, null, 2));
  }
}
