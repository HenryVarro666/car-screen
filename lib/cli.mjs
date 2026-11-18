// Node-only helpers shared by the command-line scripts.
import { readFile, appendFile, mkdir } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateProfile } from "./profile.mjs";

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) { out._.push(arg); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

// True when the module is the script being run, including through a symlinked skill folder.
export function isMain(meta) {
  if (!process.argv[1]) return false;
  try { return realpathSync(fileURLToPath(meta.url)) === realpathSync(process.argv[1]); } catch { return false; }
}

export async function loadProfile(path) {
  if (!path) throw new Error("--profile FILE is required");
  return validateProfile(JSON.parse(await readFile(path, "utf8")));
}

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const eventsFile = (dir) => join(dir, "observations.jsonl");

// Stored events: one JSON object per line, never rewritten.
export async function readEvents(dir) {
  let text;
  try { text = await readFile(eventsFile(dir), "utf8"); } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return text.split("\n").filter(Boolean).map((line, index) => ({ seq: index + 1, ...JSON.parse(line) }));
}

export async function appendEvents(dir, events) {
  if (!events.length) return;
  await mkdir(dir, { recursive: true });
  await appendFile(eventsFile(dir), events.map((e) => JSON.stringify({ id: e.id, job: e.job, run: e.run, data: e.data })).join("\n") + "\n");
}

export function today(timezone = "UTC") {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}
