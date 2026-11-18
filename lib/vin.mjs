// VIN checks: shape, check digit, model-year code, and profile rules for trim and body.
// Pure functions, usable in Node and in the browser.

const TRANSLITERATION = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789";

export const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export function checkDigit(vin) {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i];
    const value = /\d/.test(ch) ? Number(ch) : TRANSLITERATION[ch];
    sum += value * WEIGHTS[i];
  }
  const remainder = sum % 11;
  return remainder === 10 ? "X" : String(remainder);
}

// Replace position 9 with the correct check digit. Handy for building test VINs.
export function withCheckDigit(vin) {
  return vin.slice(0, 8) + checkDigit(vin) + vin.slice(9);
}

// The year code repeats every 30 years. Position 7 tells the cycles apart for
// passenger cars sold in North America: a letter there means 2010 or later.
export function modelYear(vin) {
  const index = YEAR_CODES.indexOf(vin[9]);
  if (index < 0) return null;
  const base = 1980 + index;
  return /[A-Z]/.test(vin[6]) ? base + 30 : base;
}

export function inspect(vin, model) {
  const problems = [];
  const value = String(vin ?? "").trim().toUpperCase();
  if (!VIN_PATTERN.test(value)) {
    return { vin: value, valid: false, problems: ["not 17 characters from the VIN alphabet (no I, O or Q)"] };
  }
  const expected = checkDigit(value);
  const digitOk = value[8] === expected;
  if (!digitOk) problems.push(`check digit is ${value[8]}, expected ${expected}; reread the VIN`);
  const year = modelYear(value);
  const result = { vin: value, valid: digitOk, problems, modelYear: year, labels: [] };
  if (!model) return result;

  const modelProblems = [];
  const years = model.years ?? {};
  if (year !== null && ((years.from && year < years.from) || (years.to && year > years.to))) {
    modelProblems.push(`model year ${year} is outside ${years.from ?? ""}-${years.to ?? ""}`);
  }
  for (const rule of model.vin?.require ?? []) {
    const { pattern, label } = typeof rule === "string" ? { pattern: rule } : rule;
    if (new RegExp(pattern).test(value)) { if (label) result.labels.push(label); }
    else modelProblems.push(`does not match ${label ?? pattern}`);
  }
  for (const rule of model.vin?.reject ?? []) {
    const { pattern, reason } = typeof rule === "string" ? { pattern: rule } : rule;
    if (new RegExp(pattern).test(value)) modelProblems.push(`rejected: ${reason ?? pattern}`);
  }
  for (const rule of model.vin?.label ?? []) {
    if (new RegExp(rule.pattern).test(value)) result.labels.push(rule.label);
  }
  problems.push(...modelProblems);
  result.matchesModel = modelProblems.length === 0;
  result.valid = problems.length === 0;
  return result;
}
