#!/usr/bin/env node
/**
 * Reads every sampled receipt with the scan as the working tree has it — the
 * prompt from core, then the phone's own parse, `correctOneLine` and
 * `checkScan` — and keeps each answer. By hand — docs/scan-bench.md.
 *
 *   node scripts/scan-bench/run.mjs [--label NAME] [--repeat 3] [--only r03,r50-r149] [--failed]
 *
 * The key is VERTEX_API_TOKEN, from the environment or the repo's .env. The
 * label defaults to the last commit that changed how a bill is read, marked
 * `-dirty` when those files have unsaved edits. A read already on disk is
 * skipped, so an interrupted run resumes and a larger --repeat adds reads;
 * --failed narrows that to the receipts some read so far was refused on.
 */
import "./ts.mjs";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { ROOT } from "../lib/together.mjs";
import { DATA, only, sample } from "./sample.mjs";

const core = await import(join(ROOT, "packages/core/src/index.ts"));
const { parseScanResponse } = await import(join(ROOT, "apps/web/lib/scan/response.ts"));

const { values } = parseArgs({
  options: {
    label: { type: "string" },
    repeat: { type: "string", default: "3" },
    only: { type: "string" },
    failed: { type: "boolean", default: false },
  },
});

function key() {
  if (process.env.VERTEX_API_TOKEN) return process.env.VERTEX_API_TOKEN;
  const env = join(ROOT, ".env");
  const line = existsSync(env) && readFileSync(env, "utf8").split("\n").find((l) => l.startsWith("VERTEX_API_TOKEN="));
  if (!line) throw new Error("no VERTEX_API_TOKEN in the environment or .env");
  return line.slice("VERTEX_API_TOKEN=".length).trim().replace(/^["']|["']$/g, "");
}

/** What decides a reading: a commit touching none of these reads bills the same way. */
const READING = ["packages/core/src/scan-body.ts", "packages/core/src/scan.ts", "apps/web/lib/scan/response.ts"];

function defaultLabel() {
  const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  const dirty = git("status", "--porcelain", "--", ...READING);
  return git("log", "-1", "--format=%h", "--", ...READING) + (dirty ? "-dirty" : "");
}

const label = values.label ?? defaultLabel();
const repeat = Number(values.repeat);
const named = only(values.only);
const out = join(DATA, "runs", label);
mkdirSync(out, { recursive: true });
const refused = new Set(readdirSync(out).filter((f) => f.endsWith(".json")).flatMap((f) => {
  const run = JSON.parse(readFileSync(join(out, f), "utf8"));
  return run.outcome === "ok" || run.outcome === "corrected" ? [] : [run.id];
}));
const receipts = sample().filter((r) => named(r.id) && (!values.failed || refused.has(r.id)));
const apiKey = key();
// The Worker's own date: today, UTC.
const today = new Date().toISOString().slice(0, 10);

async function call(body) {
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    // A read is a few seconds; one that stalls is retried, not waited on forever.
    const res = await fetch(core.VERTEX_URL, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    }).catch((err) => {
      if (err.name === "TimeoutError" && attempt < 5) return null;
      throw err;
    });
    if (!res || ((res.status === 429 || res.status >= 500) && attempt < 5)) {
      await new Promise((ok) => setTimeout(ok, 2000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return { json: await res.json(), ms: Date.now() - started };
  }
}

/** What `scanReceipt` does with an answer (apps/web/lib/scan/index.ts), on USD where none is read. */
function verdict(read) {
  if (read.error) return { outcome: "rejected", result: read, currency: null, lines: [] };
  const currency = core.scanCurrency(read, "USD");
  const result = core.correctOneLine(read, currency);
  const outcome = core.checkScan(result, currency) ?? (result === read ? "ok" : "corrected");
  return { outcome, result, currency, lines: result.lineItems.map((li) => core.lineMinor(li, currency)) };
}

async function one(receipt, n) {
  const path = join(out, `${receipt.id}.${n}.json`);
  if (existsSync(path)) return;
  const image = readFileSync(join(DATA, "sample/imgs", `${receipt.id}.jpg`)).toString("base64");
  const { json, ms } = await call(core.buildScanRequestBody(image, "kind", today));
  const read = parseScanResponse(json);
  const v = verdict(read);
  writeFileSync(path, JSON.stringify({ id: receipt.id, n, ms, ...v, read }, null, 1));
  report(`${receipt.id}.${n} ${v.outcome} ${ms}ms`, v.outcome);
}

const queue = receipts
  .flatMap((r) => Array.from({ length: repeat }, (_, n) => [r, n]))
  .filter(([r, n]) => !existsSync(join(out, `${r.id}.${n}.json`)));
const total = queue.length;
console.log(`${total} reads → ${out}`);

/**
 * In a terminal, one line redrawn: a bar, the outcomes so far and the time
 * left. Anywhere else a line per read, so a log keeps every one.
 */
const tally = {};
let done = 0;
const startedAt = Date.now();
function report(line, outcome) {
  if (outcome) {
    done++;
    tally[outcome] = (tally[outcome] ?? 0) + 1;
  }
  if (!process.stdout.isTTY) return console.log(line);
  if (!outcome) process.stdout.write(`\r\x1b[K${line}\n`);
  const filled = Math.round((24 * done) / Math.max(total, 1));
  const left = done ? Math.round(((Date.now() - startedAt) / done) * (total - done) / 1000) : null;
  const outcomes = Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(" · ");
  process.stdout.write(`\r\x1b[K[${"#".repeat(filled)}${".".repeat(24 - filled)}] ${done}/${total}`
    + `  ${outcomes}${left === null ? "" : `  ~${left}s left`}`);
}

// Four at once: Vertex's quota is generous, and the latency printed is not a phone's.
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let job = queue.shift(); job; job = queue.shift()) {
    try {
      await one(...job);
    } catch (err) {
      report(`${job[0].id}.${job[1]} FAILED ${err.message}`, null);
    }
  }
}));
if (process.stdout.isTTY) process.stdout.write("\n");
