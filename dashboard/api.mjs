// What the dashboard shows, built from stored events. Shared by the local server and the Worker.
import { currentState, changeFeed } from "../lib/state.mjs";
import { recommend, compare, todo, STAGES } from "../lib/rank.mjs";
import { fieldsFor } from "../lib/profile.mjs";
import { VIN_PATTERN } from "../lib/vin.mjs";

// The page needs labels and limits, not the search rules.
function publicProfile(profile) {
  return {
    id: profile.id,
    label: profile.label,
    timezone: profile.timezone,
    models: profile.models.map((m) => ({ name: m.name, years: m.years ?? {} })),
    areas: [...profile.areas, { key: "outside", label: "外地" }],
    destinations: profile.destinations,
    budget: profile.budget,
    tax: profile.tax,
    fields: profile.fields.map(({ key, label, mode, values, preferred, models }) => ({ key, label, mode, values: values ?? ["present"], preferred, models })),
    stages: STAGES,
  };
}

export function today(timezone = "UTC", now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function buildInventory(events, profile, date = today(profile.timezone)) {
  const vehicles = currentState(events, profile)
    .map((car) => ({ car, rec: recommend(car, profile, date) }))
    .sort(compare)
    .map(({ car, rec }, index) => ({
      ...car,
      rank: index + 1,
      rec,
      open: todo(car, profile).map((t) => t.label),
      fieldKeys: fieldsFor(profile, car.model).map((f) => f.key),
    }));
  const ids = new Map(vehicles.map((v) => [v.vin, v.id]));
  const runs = new Map();
  for (const event of events) {
    if (event.job === "configuration") continue;
    const at = event.data.at;
    const current = runs.get(event.job);
    if (!current || at > current.lastAt) runs.set(event.job, { job: event.job, lastAt: at, count: (current?.count ?? 0) + 1 });
    else current.count++;
  }
  return {
    profile: publicProfile(profile),
    today: date,
    vehicles,
    changes: changeFeed(events, profile, { limit: 20 }).map((c) => ({ ...c, id: ids.get(c.vin) ?? c.vin })),
    runs: [...runs.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)),
  };
}

export function buildHistory(events, profile, vin) {
  if (!VIN_PATTERN.test(vin ?? "")) return null;
  const observations = events
    .filter((e) => e.data.vin === vin)
    .sort((a, b) => (a.data.at < b.data.at ? 1 : a.data.at > b.data.at ? -1 : b.seq - a.seq))
    .map((e) => ({
      at: e.data.dateOnly ? e.data.at.slice(0, 10) : e.data.at,
      job: e.job, source: e.data.source, url: e.data.url, inventory: e.data.inventory,
      price: e.data.quote?.price, miles: e.data.miles, note: e.data.note,
      options: e.data.options ? Object.keys(e.data.options) : undefined,
    }));
  return { vin, changes: changeFeed(events, profile, { vin, limit: 200 }), observations };
}
