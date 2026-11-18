import test from "node:test";
import assert from "node:assert/strict";
import { inspect, checkDigit, modelYear } from "../lib/vin.mjs";
import { estimate, monthlyPayment, maxListPrice } from "../lib/otd.mjs";
import { profile, makeVin } from "./helpers.mjs";

const model = profile.models[0];
const tax = { rate: 0.0625, registrationReserve: 500 };
const loan = { downPayment: 15000, apr: 0.0549, termMonths: 60 };

test("check digit and model year", () => {
  assert.equal(checkDigit("1HGCM82633A004352"), "3");
  assert.equal(modelYear("1HGCM82633A004352"), 2003);
  assert.equal(inspect("1HGCM82633A004352").valid, true);
  assert.equal(modelYear(makeVin(1, { year: "M" })), 2021);
  assert.equal(modelYear(makeVin(1, { year: "S" })), 2025);
});

test("a misread VIN fails the check digit", () => {
  const good = makeVin(42);
  const bad = good.slice(0, 16) + (good[16] === "7" ? "8" : "7");
  assert.equal(inspect(good).valid, true);
  assert.match(inspect(bad).problems[0], /check digit/);
  assert.match(inspect("1HGCM82633A00435O").problems[0], /17 characters/);
});

test("profile rules gate trim, body and year", () => {
  assert.equal(inspect(makeVin(1), model).matchesModel, true);
  assert.deepEqual(inspect(makeVin(1), model).labels, ["maker", "sedan body, premium trim"]);
  const coupe = inspect(makeVin(2, { body: "CM7" }), model);
  assert.equal(coupe.matchesModel, false);
  assert.ok(coupe.problems.some((p) => /rejected: coupe body/.test(p)));
  assert.ok(inspect(makeVin(3, { year: "L" }), model).problems.some((p) => /model year 2020 is outside/.test(p)));
});

test("out-the-door estimate counts the doc fee once and untaxed", () => {
  assert.equal(estimate({ price: 40997, doc: 220 }, tax).otd, 44279.31);
  assert.equal(monthlyPayment(44279.31, loan), 559.13);
  assert.equal(estimate({ price: 40997 }, tax).otd, 44059.31);
});

test("taxable and untaxed shipping, and the shipping range", () => {
  assert.equal(estimate({ price: 52998, extraTaxable: 1699 }, tax).otd, 58615.56);
  const taxed = estimate({ price: 40000, transport: 1000, transportTaxable: true }, tax).otd;
  const untaxed = estimate({ price: 40000, transport: 1000 }, tax).otd;
  assert.equal(taxed - untaxed, 62.5);
  const ranged = estimate({ price: 40000, transport: 1000, transportMax: 1500, lowerBound: true }, tax);
  assert.equal(ranged.otdMax - ranged.otd, 500);
  assert.equal(ranged.lowerBound, true);
  assert.equal(estimate({ price: 0 }, tax), null);
});

test("payment and list-price cap", () => {
  assert.equal(monthlyPayment(60000, loan), 859.34);
  assert.equal(monthlyPayment(15000, loan), 0);
  assert.equal(maxListPrice(60000, tax), 56000);
  assert.equal(maxListPrice(60000, tax, { extraNonTaxable: 3000 }), 53176.47);
});
