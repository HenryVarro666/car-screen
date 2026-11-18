// Hosted dashboard: Cloudflare Worker + D1 + static assets.
// Not exercised against a live Cloudflare account; test/dashboard.test.mjs runs it against a local SQLite shim.
//
// Bindings (see wrangler.example.toml):
//   DB             D1 database with schema.sql applied
//   ASSETS         static assets from dashboard/public
//   VIEW_PASSWORD  secret; the page and API ask for it through HTTP Basic auth
//   SYNC_TOKEN     secret; sync.mjs sends it as a Bearer token
// The profile is bundled from dashboard/profile.json (copy your own profile there; it is git-ignored).
import profileJson from "./profile.json" with { type: "json" };
import { validateProfile } from "../lib/profile.mjs";
import { VIN_PATTERN } from "../lib/vin.mjs";
import { buildInventory, buildHistory } from "./api.mjs";

const profile = validateProfile(profileJson);
const BATCH_LIMIT = 500;
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", ...headers } });

function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function viewerAllowed(request, env) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  let decoded;
  try { decoded = atob(header.slice(6)); } catch { return false; }
  return equal(decoded.slice(decoded.indexOf(":") + 1), env.VIEW_PASSWORD);
}

async function allEvents(db) {
  const { results } = await db.prepare("SELECT seq, event_id, job, run, data FROM observations ORDER BY seq").all();
  return results.map((row) => ({ seq: row.seq, id: row.event_id, job: row.job, run: row.run, data: JSON.parse(row.data) }));
}

// Events were validated when they were added locally; here we check shape and identity only.
async function sync(request, env) {
  const header = request.headers.get("authorization") ?? "";
  if (!env.SYNC_TOKEN || !equal(header, "Bearer " + env.SYNC_TOKEN)) return json({ error: "unauthorized" }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const events = body?.events;
  if (!Array.isArray(events) || events.length > BATCH_LIMIT) return json({ error: `events must be a list of at most ${BATCH_LIMIT}` }, 400);
  for (const e of events) {
    const ok = e && /^[a-f0-9]{64}$/.test(e.id ?? "") && /^[a-z0-9][a-z0-9-]{0,39}$/.test(e.job ?? "") && /^[a-f0-9]{64}$/.test(e.run ?? "") &&
      e.data && typeof e.data === "object" && VIN_PATTERN.test(e.data.vin ?? "") && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(e.data.at ?? "");
    if (!ok) return json({ error: "malformed event" }, 400);
  }
  const insert = env.DB.prepare("INSERT INTO observations (event_id, vin, job, run, observed_at, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(event_id) DO NOTHING");
  let added = 0;
  if (events.length) {
    const results = await env.DB.batch(events.map((e) => insert.bind(e.id, e.data.vin, e.job, e.run, e.data.at, JSON.stringify(e.data))));
    added = results.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
  }
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM observations").first();
  return json({ received: events.length, added, total: total.n });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/sync" && request.method === "POST") return await sync(request, env);
      // Fail closed: without a password configured, nothing is served.
      if (!env.VIEW_PASSWORD) return json({ error: "VIEW_PASSWORD is not configured" }, 503);
      if (!viewerAllowed(request, env)) {
        return new Response("Sign in", { status: 401, headers: { "www-authenticate": 'Basic realm="car-screen", charset="UTF-8"' } });
      }
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "read only" }, 405);
      if (url.pathname === "/api/inventory") return json(buildInventory(await allEvents(env.DB), profile));
      if (url.pathname === "/api/history") {
        const history = buildHistory(await allEvents(env.DB), profile, url.searchParams.get("vin"));
        return history ? json(history) : json({ error: "specify a VIN" }, 400);
      }
      if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("request failed", error);
      return json({ error: "request failed" }, 500);
    }
  },
};
