import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRun } from "../lib/observation.mjs";
import { validateProfile } from "../lib/profile.mjs";
import { profile, makeVin, vehicle, observation, run } from "./helpers.mjs";

const vin = makeVin(1);
const ok = (over) => normalizeRun(run([observation(vin, { vehicle: vehicle("N1"), inventory: "listed", ...over })]), profile);

test("a complete first observation passes", () => {
  const out = ok({ quote: { price: 30000, basis: "dealer page" }, miles: 20000, options: { sportPackage: { value: "present", evidence: "A" } } });
  assert.equal(out.observations[0].quote.price, 30000);
  assert.equal(out.observations[0].approximateMiles, false);
});

test("a blocked page is unverified, never sold, and never carries a quote", () => {
  assert.throws(() => ok({ inventory: "unverified", quote: { price: 30000, basis: "cache" } }), /unverified read cannot carry a quote/);
  assert.throws(() => ok({ inventory: "unverified" }), /needs a note saying what blocked it/);
  assert.equal(ok({ inventory: "unverified", note: "dealer site returned 403" }).observations[0].inventory, "unverified");
  assert.throws(() => ok({ inventory: "sold", quote: { price: 30000, basis: "old ad" } }), /carries no current quote/);
});

test("option evidence rules", () => {
  assert.throws(() => ok({ options: { sportPackage: { value: "present" } } }), /needs evidence A/);
  assert.throws(() => ok({ options: { sportPackage: { value: "absent", evidence: "B" } } }), /only be "absent" on grade A/);
  assert.throws(() => ok({ options: { sportPackage: { value: "unknown", evidence: "B" } } }), /carries no evidence grade/);
  assert.throws(() => ok({ options: { heatedSeats: { value: "present", evidence: "A" } } }), /not a field of this profile/);
  assert.throws(() => ok({ options: { appearancePackage: { value: "present", evidence: "A" } } }), /must be one of standard, plus, absent, unknown/);
  assert.equal(ok({ options: { appearancePackage: { value: "plus", evidence: "B" } } }).observations[0].options.appearancePackage.value, "plus");
});

test("vehicle and quote rules", () => {
  assert.throws(() => ok({ vehicle: vehicle("X1") }), /vehicle.id must be N plus a number/);
  assert.throws(() => ok({ vehicle: vehicle("N1", { area: "mars" }) }), /vehicle.area must be one of home, second, outside/);
  assert.throws(() => ok({ vehicle: vehicle("N1", { model: "Truck" }) }), /vehicle.model must be one of/);
  assert.throws(() => ok({ quote: { price: 30000 } }), /needs price and basis/);
  assert.throws(() => ok({ quote: { price: 30000, basis: "x", transport: 900 } }), /transport needs a destination/);
  assert.throws(() => ok({ quote: { price: 30000, basis: "x", priceLabel: "bargain" } }), /priceLabel must be one of/);
  assert.throws(() => ok({ arrival: "next week" }), /arrival only applies to transferable/);
});

test("run rules", () => {
  assert.throws(() => normalizeRun(run([], { partial: false }), profile), /empty run must be marked partial/);
  assert.throws(() => normalizeRun(run([observation(vin, { at: "2030-01-11T09:00", vehicle: vehicle("N1") })]), profile), /later than the run/);
  assert.throws(() => normalizeRun(run([observation(vin, { url: "http://insecure.example", vehicle: vehicle("N1") })]), profile), /HTTPS URL/);
  assert.throws(() => normalizeRun(run([observation(vin, {})]), profile), /empty observation/);
  assert.throws(() => normalizeRun(run([], { job: "Bad Job" }), profile), /job must be/);
});

test("auction observations", () => {
  const out = ok({ inventory: "auction", auction: { status: "live", highBid: 31000, ends: "2030-01-12T14:00", reserve: true } });
  assert.equal(out.observations[0].auction.highBid, 31000);
  assert.throws(() => ok({ inventory: "listed", auction: { status: "live" } }), /auction details go with inventory/);
  assert.throws(() => ok({ inventory: "sold", auction: { status: "sold" } }), /sold auction needs salePrice/);
});

test("every tracked field must say whether it eliminates, ranks or only records", () => {
  const broken = structuredClone(profile);
  delete broken.fields[0].mode;
  assert.throws(() => validateProfile(broken), /mode must be one of eliminate, rank, record/);
});
