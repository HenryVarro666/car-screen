#!/usr/bin/env node
// Push local observations to a hosted dashboard. Safe to rerun: the server keeps one copy of each event.
//   node dashboard/sync.mjs --data DIR --url https://your-worker.example
// The sync token is read from the CAR_SCREEN_SYNC_TOKEN environment variable, or typed at the prompt.
import { parseArgs, isMain, readEvents, fail } from "../lib/cli.mjs";

async function readToken() {
  if (process.env.CAR_SCREEN_SYNC_TOKEN) return process.env.CAR_SCREEN_SYNC_TOKEN;
  if (!process.stdin.isTTY) fail("set CAR_SCREEN_SYNC_TOKEN or run in a terminal to type the token");
  process.stderr.write("sync token: ");
  process.stdin.setRawMode(true);
  let token = "";
  for await (const chunk of process.stdin) {
    const text = chunk.toString();
    if (text === "\r" || text === "\n" || text === "\u0003") break;
    token += text;
  }
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stderr.write("\n");
  return token.trim();
}

async function post(url, token, events) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(new URL("/api/sync", url), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(20_000),
      redirect: "manual",
    }).catch((error) => ({ ok: false, status: 0, text: async () => error.message }));
    if (response.ok) return response.json();
    const retryable = response.status === 0 || response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 3) fail(`sync failed (${response.status}): ${await response.text()}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
}

if (isMain(import.meta)) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.data || !args.url) fail("Usage: sync.mjs --data DIR --url https://your-worker.example", 2);
  if (!String(args.url).startsWith("https://")) fail("--url must be https");
  const events = (await readEvents(args.data)).map(({ id, job, run, data }) => ({ id, job, run, data }));
  const token = await readToken();
  let added = 0, total = 0;
  for (let i = 0; i < events.length; i += 400) {
    const result = await post(args.url, token, events.slice(i, i + 400));
    added += result.added;
    total = result.total;
  }
  console.log(JSON.stringify({ sent: events.length, added, total, verified: total >= events.length }));
}
