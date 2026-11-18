// Profile: everything that used to be hardcoded (models, regions, budget, tax, tracked fields).
// Pure validation, usable in Node and in the browser.

export const FIELD_MODES = ["eliminate", "rank", "record"];
export const RESERVED_VALUES = ["absent", "unknown"];

export class ProfileError extends Error {}

function need(condition, message) {
  if (!condition) throw new ProfileError("profile: " + message);
}

export function validateProfile(input) {
  need(input && typeof input === "object", "must be an object");
  need(/^[a-z0-9-]{1,40}$/.test(input.id ?? ""), "id must be lowercase letters, digits and dashes");
  need(typeof input.label === "string" && input.label, "label is required");

  need(Array.isArray(input.models) && input.models.length, "models must list at least one model");
  const prefixes = new Set();
  for (const model of input.models) {
    need(typeof model.name === "string" && model.name, "each model needs a name");
    need(/^[A-Z][A-Z0-9]{0,3}$/.test(model.idPrefix ?? ""), `${model.name}: idPrefix must be 1-4 capital letters or digits, starting with a letter`);
    need(!prefixes.has(model.idPrefix), `${model.name}: idPrefix ${model.idPrefix} is used twice`);
    prefixes.add(model.idPrefix);
    for (const rule of [...(model.vin?.require ?? []), ...(model.vin?.reject ?? []), ...(model.vin?.label ?? [])]) {
      const pattern = typeof rule === "string" ? rule : rule.pattern;
      try { new RegExp(pattern); } catch { need(false, `${model.name}: bad VIN pattern ${pattern}`); }
    }
  }

  need(Array.isArray(input.areas) && input.areas.length, "areas must list at least one area");
  for (const area of input.areas) {
    need(/^[a-z0-9-]{1,20}$/.test(area.key ?? "") && area.key !== "outside", "area keys are short lowercase words; 'outside' is built in");
    need(area.label, `area ${area.key} needs a label`);
  }

  need(Array.isArray(input.destinations) && input.destinations.length, "destinations must list at least one ZIP");
  for (const dest of input.destinations) need(/^\d{5}$/.test(dest.zip ?? "") && dest.label, "each destination needs a 5-digit zip and a label");

  const budget = input.budget ?? {};
  need(budget.otdCap > 0, "budget.otdCap is required");
  need(budget.downPayment >= 0 && budget.apr >= 0 && budget.apr < 1 && Number.isInteger(budget.termMonths) && budget.termMonths > 0,
    "budget needs downPayment, apr (as a fraction, e.g. 0.0549) and termMonths");

  const tax = input.tax ?? {};
  need(tax.rate >= 0 && tax.rate < 1 && tax.registrationReserve >= 0, "tax needs rate (a fraction) and registrationReserve");

  if (input.staleDays !== undefined) need(Number.isInteger(input.staleDays) && input.staleDays >= 0, "staleDays must be a whole number of days");
  need(Array.isArray(input.fields), "fields must be an array (it may be empty)");
  const keys = new Set();
  for (const field of input.fields) {
    need(/^[a-zA-Z][a-zA-Z0-9]{0,30}$/.test(field.key ?? ""), "each field needs a camelCase key");
    need(!keys.has(field.key), `field ${field.key} is listed twice`);
    keys.add(field.key);
    need(field.label, `field ${field.key} needs a label`);
    // The mode is mandatory on purpose: "stop tracking X" and "reject cars with X" are different rules.
    need(FIELD_MODES.includes(field.mode), `field ${field.key}: mode must be one of ${FIELD_MODES.join(", ")}`);
    if (field.values !== undefined) {
      need(Array.isArray(field.values) && field.values.length && field.values.every((v) => typeof v === "string" && !RESERVED_VALUES.includes(v)),
        `field ${field.key}: values lists the "present" states; absent and unknown are built in`);
    }
    if (field.preferred !== undefined) {
      need(Array.isArray(field.preferred) && field.preferred.length && field.preferred.every((v) => (field.values ?? ["present"]).includes(v)),
        `field ${field.key}: preferred must list values from this field`);
    }
    if (field.models !== undefined) {
      need(Array.isArray(field.models) && field.models.every((m) => input.models.some((model) => model.name === m)),
        `field ${field.key}: models must name models from this profile`);
    }
  }
  return input;
}

export const fieldValues = (field) => [...(field.values ?? ["present"]), ...RESERVED_VALUES];
// With no model name, every field is returned; the caller checks the model once it is known.
export const fieldsFor = (profile, modelName) => profile.fields.filter((f) => !modelName || !f.models || f.models.includes(modelName));
export const areaKeys = (profile) => [...profile.areas.map((a) => a.key), "outside"];
export const modelByName = (profile, name) => profile.models.find((m) => m.name === name);
