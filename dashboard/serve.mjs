#!/usr/bin/env node
// Local dashboard. Reads the profile and observations.jsonl on every request, so it is always current.
//   node dashboard/serve.mjs --profile FILE --data DIR [--port 4173]
// It listens on 127.0.0.1 only.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, isMain, loadProfile, readEvents, fail } from "../lib/cli.mjs";
import { buildInventory, buildHistory } from "./api.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

export function createApp({ profilePath, dataDir, now }) {
  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const send = (status, body, type = "application/json; charset=utf-8") => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    try {
      if (req.method !== "GET" && req.method !== "HEAD") return send(405, { error: "read only" });
      if (url.pathname.startsWith("/api/")) {
        const profile = await loadProfile(profilePath);
        const events = await readEvents(dataDir);
        if (url.pathname === "/api/inventory") return send(200, buildInventory(events, profile, now?.()));
        if (url.pathname === "/api/history") {
          const history = buildHistory(events, profile, url.searchParams.get("vin"));
          return history ? send(200, history) : send(400, { error: "specify a VIN" });
        }
        return send(404, { error: "not found" });
      }
      const name = url.pathname === "/" ? "index.html" : normalize(url.pathname).replace(/^[/\\]+/, "");
      if (name.includes("..") || !TYPES[extname(name)]) return send(404, "Not found", "text/plain");
      return send(200, await readFile(join(here, "public", name)), TYPES[extname(name)]);
    } catch (error) {
      if (error.code === "ENOENT") return send(404, "Not found", "text/plain");
      return send(500, { error: error.message });
    }
  };
}

if (isMain(import.meta)) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.profile || !args.data) fail("Usage: serve.mjs --profile FILE --data DIR [--port 4173]", 2);
  await loadProfile(args.profile);
  const port = Number(args.port ?? 4173);
  createServer(createApp({ profilePath: args.profile, dataDir: args.data })).listen(port, "127.0.0.1", () => {
    console.log(`car-screen dashboard: http://localhost:${port}`);
  });
}
