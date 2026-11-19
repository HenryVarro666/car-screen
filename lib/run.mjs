// Turn a validated run into new stored events, refusing anything that would corrupt the record.
// Shared by the command line and the dashboard. Needs node:crypto (Node, or Workers with nodejs_compat).
import { createHash } from "node:crypto";
import { normalizeRun, InputError } from "./observation.mjs";
import { soldArchive } from "./state.mjs";
import { inspect } from "./vin.mjs";
import { modelByName } from "./profile.mjs";

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

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
    if (!reopen && sold.has(data.vin) && data.inventory !== "sold" && run.job !== "configuration") {
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

