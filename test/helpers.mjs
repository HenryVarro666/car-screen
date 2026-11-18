import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { withCheckDigit } from "../lib/vin.mjs";
import { validateProfile } from "../lib/profile.mjs";

export const repo = dirname(dirname(fileURLToPath(import.meta.url)));
export const profile = validateProfile(JSON.parse(readFileSync(join(repo, "profiles", "example.json"), "utf8")));

// Invented VINs with a correct check digit. Year code M = 2021, P = 2023.
export const makeVin = (serial, { year = "P", body = "CM8" } = {}) =>
  withCheckDigit(`1HG${body}A60${year}A${String(serial).padStart(6, "0")}`);

export const vehicle = (id, over = {}) => ({
  id, model: "Sport Sedan", year: 2023, title: `Sedan ${id}`, dealer: "Example Motors", city: "Springfield, ST",
  area: "home", priority: "main", listing: `https://dealer.example/cars/${id}`, ...over,
});

export const observation = (vin, over = {}) => ({
  vin, at: "2030-01-10T09:00", source: "dealer page", url: "https://dealer.example/cars/x", ...over,
});

export const run = (observations, over = {}) => ({ job: "manual", completedAt: "2030-01-10T10:00", partial: false, observations, ...over });

let seq = 0;
export const stored = (data, job = "manual") => ({ seq: ++seq, id: "e" + seq, job, data });
