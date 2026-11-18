// Validate one run of observations against a profile.
// A run is what one search or recheck produced: { job, completedAt, partial, observations[] }.
// Pure functions, usable in Node, in a Worker and in the browser.
import { VIN_PATTERN } from "./vin.mjs";
import { areaKeys, fieldsFor, fieldValues, modelByName } from "./profile.mjs";

export const INVENTORY = [
  "available", "transferable", "listed", "on_hold", "coming_soon",
  "unavailable", "sold", "unverified", "private_lead", "auction",
];
export const IN_STOCK = ["available", "transferable", "listed"];
export const CLOSED = ["sold", "unavailable"];
export const PRIORITIES = ["watch", "main", "wait", "risk"];
export const HISTORY_GRADES = ["clean", "concern", "damage", "unknown"];
export const EVIDENCE = ["A", "B"];
export const AUCTION_STATUS = ["live", "sold", "sold_after", "reserve_not_met", "cancelled"];
export const EVENT_LIMIT = 200;

const VEHICLE_TEXT = [
  "id", "model", "generation", "title", "dealer", "city", "area", "stock", "color", "paint", "priority",
  "highlight", "warranty", "history", "historyGrade", "risk", "next", "target", "listing", "sellerType",
];
const VEHICLE_REQUIRED = ["id", "model", "title", "dealer", "city", "area", "priority"];
const QUOTE_NUMBERS = ["price", "doc", "transport", "transportMax", "extraTaxable", "extraNonTaxable"];
const QUOTE_FLAGS = ["transportTaxable", "lowerBound"];
const QUOTE_TEXT = ["priceLabel", "basis", "feeNote", "destination"];

export class InputError extends Error {}

function check(condition, message) {
  if (!condition) throw new InputError(message);
}

function object(value, label) {
  check(value && typeof value === "object" && !Array.isArray(value), label + " must be an object");
}

function text(value, label, max = 500) {
  check(typeof value === "string" && value.trim() && value.length <= max, `${label} must be text of 1-${max} characters`);
  return value.trim();
}

// Local wall-clock time in the profile's timezone: YYYY-MM-DD or YYYY-MM-DDTHH:MM[:SS].
function localTime(value, label, requireTime = false) {
  check(typeof value === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(value), label + " must be a local date or date-time");
  const full = value.length === 10 ? value + "T00:00:00" : value.length === 16 ? value + ":00" : value;
  const parsed = new Date(full + "Z");
  check(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === full, label + " is not a real date");
  check(!requireTime || value.length > 10, label + " must include the time");
  return full;
}

function httpsUrl(value, label) {
  const input = text(value, label, 1600);
  let url;
  try { url = new URL(input); } catch { throw new InputError(label + " must be an HTTPS URL"); }
  check(url.protocol === "https:" && !url.username && !url.password, label + " must be an HTTPS URL");
  return input;
}

function dollars(value, label) {
  check(typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 9_999_999, label + " must be a dollar amount");
  check(Math.abs(value * 100 - Math.round(value * 100)) < 0.001, label + " must use at most two decimals");
  return value;
}

function normalizeVehicle(input, vin, profile) {
  object(input, "vehicle");
  const vehicle = {};
  for (const key of VEHICLE_TEXT) {
    if (input[key] !== undefined) vehicle[key] = text(input[key], "vehicle." + key, key === "listing" ? 1600 : 1100);
  }
  for (const key of VEHICLE_REQUIRED) check(vehicle[key], `${vin}: vehicle.${key} is required`);
  const model = modelByName(profile, vehicle.model);
  check(model, `${vin}: vehicle.model must be one of ${profile.models.map((m) => m.name).join(", ")}`);
  check(new RegExp(`^${model.idPrefix}\\d{1,4}$`).test(vehicle.id), `${vin}: vehicle.id must be ${model.idPrefix} plus a number`);
  check(Number.isInteger(input.year) && input.year >= 1980 && input.year <= 2099, `${vin}: vehicle.year is invalid`);
  check(areaKeys(profile).includes(vehicle.area), `${vin}: vehicle.area must be one of ${areaKeys(profile).join(", ")}`);
  check(PRIORITIES.includes(vehicle.priority), `${vin}: vehicle.priority must be one of ${PRIORITIES.join(", ")}`);
  if (vehicle.historyGrade) check(HISTORY_GRADES.includes(vehicle.historyGrade), `${vin}: vehicle.historyGrade must be one of ${HISTORY_GRADES.join(", ")}`);
  if (vehicle.paint) check(/^#[a-fA-F0-9]{6}$/.test(vehicle.paint), `${vin}: vehicle.paint must be a hex color`);
  if (vehicle.listing) httpsUrl(vehicle.listing, "vehicle.listing");
  vehicle.year = input.year;
  if (input.warrantyUntil !== undefined) {
    check(/^\d{4}-\d{2}-\d{2}$/.test(input.warrantyUntil), `${vin}: vehicle.warrantyUntil must be YYYY-MM-DD`);
    vehicle.warrantyUntil = input.warrantyUntil;
  }
  if (input.warrantyMiles !== undefined) {
    check(Number.isInteger(input.warrantyMiles) && input.warrantyMiles > 0, `${vin}: vehicle.warrantyMiles must be a whole number`);
    vehicle.warrantyMiles = input.warrantyMiles;
  }
  if (input.specs !== undefined) {
    object(input.specs, "vehicle.specs");
    check(Object.keys(input.specs).length <= 12, "vehicle.specs holds at most 12 entries");
    vehicle.specs = Object.fromEntries(Object.entries(input.specs).map(([k, v]) => [text(k, "spec label", 40), text(v, "spec " + k, 1100)]));
  }
  if (input.links !== undefined) {
    check(Array.isArray(input.links) && input.links.length <= 8, "vehicle.links must be a list of up to 8 links");
    vehicle.links = input.links.map((pair) => {
      check(Array.isArray(pair) && pair.length === 2, "each link is [label, https url]");
      return [text(pair[0], "link label", 100), httpsUrl(pair[1], "link URL")];
    });
  }
  return vehicle;
}

function normalizeQuote(input, vin, profile) {
  object(input, "quote");
  const quote = {};
  for (const key of QUOTE_NUMBERS) if (input[key] !== undefined) quote[key] = dollars(input[key], "quote." + key);
  for (const key of QUOTE_FLAGS) {
    if (input[key] !== undefined) {
      check(typeof input[key] === "boolean", `quote.${key} must be true or false`);
      quote[key] = input[key];
    }
  }
  for (const key of QUOTE_TEXT) if (input[key] !== undefined) quote[key] = text(input[key], "quote." + key);
  check(quote.price > 0 && quote.basis, `${vin}: a quote needs price and basis (what the price is and where it was read)`);
  if (quote.priceLabel !== undefined && profile.priceLabels) {
    check(profile.priceLabels.includes(quote.priceLabel), `${vin}: quote.priceLabel must be one of ${profile.priceLabels.join(", ")}`);
  }
  check(quote.transportMax === undefined || quote.transportMax > (quote.transport ?? 0), `${vin}: transportMax must exceed transport`);
  check(quote.transport === undefined || quote.destination, `${vin}: transport needs a destination`);
  return quote;
}

function normalizeOptions(input, vin, modelName, profile) {
  object(input, "options");
  const fields = fieldsFor(profile, modelName);
  const options = {};
  for (const [key, raw] of Object.entries(input)) {
    const field = fields.find((f) => f.key === key);
    check(field, `${vin}: options.${key} is not a field of this profile${modelName ? " for " + modelName : ""}`);
    object(raw, "options." + key);
    check(fieldValues(field).includes(raw.value), `${vin}: options.${key}.value must be one of ${fieldValues(field).join(", ")}`);
    const entry = { value: raw.value };
    if (raw.value === "unknown") {
      check(raw.evidence === undefined, `${vin}: options.${key} is unknown, so it carries no evidence grade`);
    } else {
      check(EVIDENCE.includes(raw.evidence), `${vin}: options.${key} needs evidence A (same-VIN sticker or build sheet) or B (seller text about this car)`);
      // A missing line on a partial list proves nothing; only a complete same-VIN list can show absence.
      check(raw.value !== "absent" || raw.evidence === "A", `${vin}: options.${key} can only be "absent" on grade A evidence`);
      entry.evidence = raw.evidence;
    }
    if (raw.source !== undefined) entry.source = text(raw.source, `options.${key}.source`, 300);
    options[key] = entry;
  }
  check(Object.keys(options).length, `${vin}: options is empty`);
  return options;
}

function normalizeTried(input, vin, profile) {
  check(Array.isArray(input) && input.length <= 30, "tried must be a list");
  return input.map((item) => {
    object(item, "tried entry");
    check(item.field === "history" || item.field === "warranty" || profile.fields.some((f) => f.key === item.field),
      `${vin}: tried.field must be a profile field, "history" or "warranty"`);
    return { field: item.field, channel: text(item.channel, "tried.channel", 80), result: text(item.result ?? "nothing found", "tried.result", 200) };
  });
}

function normalizeAuction(input, vin) {
  object(input, "auction");
  check(AUCTION_STATUS.includes(input.status), `${vin}: auction.status must be one of ${AUCTION_STATUS.join(", ")}`);
  const auction = { status: input.status };
  if (input.highBid !== undefined) auction.highBid = dollars(input.highBid, "auction.highBid");
  if (input.salePrice !== undefined) auction.salePrice = dollars(input.salePrice, "auction.salePrice");
  if (input.ends !== undefined) auction.ends = localTime(input.ends, "auction.ends", true);
  if (input.reserve !== undefined) { check(typeof input.reserve === "boolean", "auction.reserve must be true or false"); auction.reserve = input.reserve; }
  check(input.status !== "reserve_not_met" || auction.salePrice === undefined, `${vin}: a reserve-not-met auction has no sale price`);
  check(!["sold", "sold_after"].includes(input.status) || auction.salePrice !== undefined, `${vin}: a sold auction needs salePrice`);
  return auction;
}

export function normalizeObservation(input, job, completedAt, profile) {
  object(input, "observation");
  const vin = text(input.vin, "vin", 17).toUpperCase();
  check(VIN_PATTERN.test(vin), vin + ": invalid VIN");
  const dateOnly = typeof input.at === "string" && input.at.length === 10;
  const at = localTime(input.at, vin + ": observation.at");
  check(at <= completedAt, vin + ": observation is later than the run's completion time");
  const entry = { vin, at, dateOnly, source: text(input.source, vin + ": source", 160) };
  entry.url = httpsUrl(input.url, vin + ": url");

  if (input.inventory !== undefined) {
    check(INVENTORY.includes(input.inventory), `${vin}: inventory must be one of ${INVENTORY.join(", ")}`);
    entry.inventory = input.inventory;
  }
  if (input.quote !== undefined) entry.quote = normalizeQuote(input.quote, vin, profile);
  if (input.vehicle !== undefined) entry.vehicle = normalizeVehicle(input.vehicle, vin, profile);
  if (input.options !== undefined) entry.options = normalizeOptions(input.options, vin, entry.vehicle?.model, profile);
  if (input.tried !== undefined) entry.tried = normalizeTried(input.tried, vin, profile);
  if (input.auction !== undefined) entry.auction = normalizeAuction(input.auction, vin);
  if (input.miles !== undefined) {
    check(Number.isInteger(input.miles) && input.miles >= 0 && input.miles < 1_000_000, vin + ": miles must be a whole number");
    entry.miles = input.miles;
    entry.approximateMiles = input.approximateMiles === true;
  }
  if (input.arrival !== undefined) entry.arrival = text(input.arrival, "arrival", 100);
  if (input.note !== undefined) entry.note = text(input.note, "note", 650);

  check(entry.inventory || entry.quote || entry.vehicle || entry.options || entry.tried || entry.auction || entry.miles !== undefined,
    vin + ": empty observation");
  // A blocked page, a login wall or a missing search result is not a status.
  check(entry.inventory !== "unverified" || !entry.quote, vin + ": an unverified read cannot carry a quote");
  check(entry.inventory !== "unverified" || entry.note, vin + ": an unverified read needs a note saying what blocked it");
  check(!CLOSED.includes(entry.inventory) || !entry.quote, vin + ": a sold or delisted car carries no current quote");
  check(!entry.arrival || entry.inventory === "transferable", vin + ": arrival only applies to transferable cars");
  check(!entry.auction || entry.inventory === "auction" || CLOSED.includes(entry.inventory), vin + ": auction details go with inventory \"auction\" (or sold/unavailable once it ends)");
  return entry;
}

export function normalizeRun(input, profile) {
  object(input, "run");
  check(/^[a-z0-9][a-z0-9-]{0,39}$/.test(input.job ?? ""), "job must be a short lowercase name such as patrol, manual or car-123");
  const completedAt = localTime(input.completedAt, "completedAt", true);
  check(typeof input.partial === "boolean", "partial must be true or false");
  check(Array.isArray(input.observations) && input.observations.length <= EVENT_LIMIT, `observations must be a list of at most ${EVENT_LIMIT}`);
  check(input.observations.length > 0 || input.partial, "an empty run must be marked partial");
  const observations = input.observations.map((o) => normalizeObservation(o, input.job, completedAt, profile));
  return { job: input.job, completedAt, partial: input.partial, observations };
}
