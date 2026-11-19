// Current state and change feed, computed from the append-only list of observations.
// Each stored event is { seq, id, job, data } where data is a normalized observation.
// Pure functions, usable in Node, in a Worker and in the browser.
import { estimate, monthlyPayment } from "./otd.mjs";
import { CLOSED } from "./observation.mjs";

const order = (a, b) => (a.data.at < b.data.at ? -1 : a.data.at > b.data.at ? 1 : a.seq - b.seq);

export function quoteKey(quote) {
  if (!quote) return null;
  return JSON.stringify([
    Math.round(quote.price * 100), quote.priceLabel ?? null, quote.doc ?? null, quote.transport ?? null,
    quote.transportMax ?? null, quote.transportTaxable ?? false, quote.extraTaxable ?? null,
    quote.extraNonTaxable ?? null, quote.lowerBound ?? false, quote.destination ?? null,
  ]);
}

function view(event, profile) {
  if (!event) return null;
  const d = event.data;
  const out = { at: d.dateOnly ? d.at.slice(0, 10) : d.at, url: d.url, source: d.source, job: event.job };
  if (d.inventory) out.inventory = d.inventory;
  if (d.note) out.note = d.note;
  if (d.arrival) out.arrival = d.arrival;
  if (d.quote) {
    const est = estimate(d.quote, profile.tax);
    out.quote = { ...d.quote, ...est, monthly: monthlyPayment(est.otd, profile.budget) };
  }
  return out;
}

// One record per VIN: the latest value of each kind of fact, each from its own observation.
export function currentState(events, profile) {
  const byVin = new Map();
  for (const event of [...events].sort(order)) {
    const d = event.data;
    const car = byVin.get(d.vin) ?? { vin: d.vin, options: {}, tried: [] };
    if (d.vehicle) car.vehicleEvent = event;
    if (d.quote) car.quoteEvent = event;
    if (d.inventory) {
      car.inventoryEvent = event;
      if (d.inventory !== "unverified") car.confirmedEvent = event;
    }
    if (d.miles !== undefined) car.milesEvent = event;
    if (d.auction) car.auctionEvent = event;
    if (d.configuration) {
      car.configuration = { ...d.configuration, date: d.at.slice(0, 10), source: d.source };
    }
    for (const [key, value] of Object.entries(d.options ?? {})) car.options[key] = { ...value, at: d.at.slice(0, 10), url: d.url };
    for (const item of d.tried ?? []) car.tried.push({ ...item, at: d.at.slice(0, 10) });
    if (event.job !== "configuration") car.lastEvent = event;
    byVin.set(d.vin, car);
  }
  const vehicles = [];
  for (const car of byVin.values()) {
    if (!car.vehicleEvent) continue;
    const confirmed = view(car.confirmedEvent, profile);
    // A quote older than the car being confirmed sold or delisted no longer applies.
    const closed = confirmed && CLOSED.includes(confirmed.inventory);
    vehicles.push({
      ...car.vehicleEvent.data.vehicle,
      vin: car.vin,
      miles: car.milesEvent?.data.miles,
      approximateMiles: car.milesEvent?.data.approximateMiles,
      options: car.options,
      ...(car.configuration ? { configuration: car.configuration } : {}),
      tried: car.tried,
      last: view(car.lastEvent, profile),
      inventory: view(car.inventoryEvent, profile),
      confirmed,
      closed: Boolean(closed),
      quoteRecord: view(car.quoteEvent, profile),
      auction: car.auctionEvent ? { ...car.auctionEvent.data.auction, at: car.auctionEvent.data.at, url: car.auctionEvent.data.url } : null,
    });
  }
  return vehicles;
}

// Status, quote and arrival changes, newest first.
export function changeFeed(events, profile, { vin, limit = 16 } = {}) {
  const previous = new Map();
  const changes = [];
  for (const event of [...events].sort(order)) {
    const d = event.data;
    if (vin && d.vin !== vin) continue;
    const before = previous.get(d.vin) ?? {};
    const stockChanged = Boolean(d.inventory) && d.inventory !== before.inventory;
    const key = quoteKey(d.quote);
    const quoteChanged = key !== null && key !== before.quoteKey;
    const arrivalChanged = d.inventory === "transferable" && Boolean(d.arrival) && d.arrival !== before.arrival;
    if (stockChanged || quoteChanged || arrivalChanged) {
      changes.push({
        ...view(event, profile), seq: event.seq, vin: d.vin,
        previousStatus: before.inventory ?? null,
        previousQuote: before.quote ? { ...before.quote, ...estimate(before.quote, profile.tax) } : null,
        stockChanged, quoteChanged, arrivalChanged, firstSeen: !before.seen,
      });
    }
    previous.set(d.vin, {
      seen: true,
      inventory: d.inventory ?? before.inventory,
      arrival: d.inventory ? d.arrival : before.arrival,
      quoteKey: key ?? before.quoteKey,
      quote: d.quote ?? before.quote,
    });
  }
  return changes.reverse().slice(0, limit);
}

// VINs confirmed sold. New observations for them are refused unless they say "sold" again.
export function soldArchive(events) {
  const latest = new Map();
  for (const event of [...events].sort(order)) {
    const d = event.data;
    if (d.inventory && d.inventory !== "unverified") latest.set(d.vin, d.inventory);
  }
  return new Set([...latest].filter(([, status]) => status === "sold").map(([vin]) => vin));
}

export function nextId(events, profile, modelName) {
  const model = profile.models.find((m) => m.name === modelName);
  if (!model) return null;
  let max = 0;
  for (const event of events) {
    const id = event.data.vehicle?.id;
    const match = id && id.match(new RegExp(`^${model.idPrefix}(\\d+)$`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return model.idPrefix + (max + 1);
}
