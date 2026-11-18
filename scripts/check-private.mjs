#!/usr/bin/env node
// Refuse to publish personal data. Scans tracked and untracked (not ignored) files for:
//   - any 17-character VIN that is not on the sample allowlist below
//   - every pattern listed in a private patterns file kept outside the repo
// Patterns file: $CAR_TOOLS_PRIVATE_PATTERNS or ~/.config/car-tools/private-patterns.txt
// One pattern per line, plain text, case-insensitive. Lines starting with # are ignored.
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const SAMPLE_VINS = new Set(["1HGCM82633A004352", "1HGCM82633A004353", "1HGCM82633A004354", "1HGCM82633A004355"]);
const VIN = /\b[A-HJ-NPR-Z0-9]{17}\b/g;

const patternsPath = process.env.CAR_TOOLS_PRIVATE_PATTERNS ?? join(homedir(), ".config", "car-tools", "private-patterns.txt");
let patterns = [];
try {
  patterns = (await readFile(patternsPath, "utf8")).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
} catch {
  console.error(`note: no patterns file at ${patternsPath}; only the VIN check runs`);
}

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const hits = [];
for (const file of files) {
  let text;
  try { text = await readFile(file, "utf8"); } catch { continue; }
  if (text.includes("\u0000")) continue;
  text.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(VIN)) {
      // A real VIN mixes letters and digits; skip plain words and numbers.
      if (!/[A-Z]/.test(match[0]) || !/\d/.test(match[0]) || SAMPLE_VINS.has(match[0])) continue;
      hits.push(`${file}:${index + 1}: VIN-shaped value ${match[0]}`);
    }
    const lower = line.toLowerCase();
    for (const pattern of patterns) {
      if (lower.includes(pattern.toLowerCase())) hits.push(`${file}:${index + 1}: private pattern "${pattern}"`);
    }
  });
}

if (hits.length) {
  for (const hit of hits) console.error(hit);
  console.error(`\n${hits.length} hit(s). Do not push.`);
  process.exit(1);
}
console.log(`clean: ${files.length} files, ${patterns.length} private patterns checked`);
