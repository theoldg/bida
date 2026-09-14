/**
 * Enforcing `SCAN_LIMITS` (core), and the two checks that have nowhere else to
 * live: the one-way client key, and Turnstile.
 *
 * The scan endpoint is the one place in this app that spends money, and the
 * credential in front of it is deliberately cheap to mint — `ensureGroup`
 * registers any unseen id on first sight, because that is how a quick split
 * works (ADR-0035). So the bearer check is a speed bump and these are the
 * gates. Why each number is what it is:
 * docs/receipt-scanning.md#what-the-scan-costs.
 */

import { SCAN_LIMITS, type ScanLimitScope } from "@bida/core";

/** Stands in for a client key on a deployment with no salt — see `countScans`. */
const UNSALTED = "unsalted";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * The caller's address, one way. Never the address itself: there are four
 * billion IPv4s, so a bare `sha256` of one is an IP with extra steps — a
 * rainbow table is minutes of laptop time. The key is a Worker secret
 * (`SCAN_IP_SALT`), so a leaked D1 row is noise to anyone but us. Truncated
 * because 64 bits is already far past collision at this scale, and rotating
 * the secret only resets buckets that live 24h anyway.
 */
export async function clientKey(ip: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  return [...new Uint8Array(mac)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Which bucket is full, or null. `global` is asked first because it is the one
 * refusal that isn't about the person reading it.
 */
export function overLimit(counts: ScanCounts): ScanLimitScope | null {
  for (const scope of ["global", "client", "caller"] as const) {
    const { hour, day } = SCAN_LIMITS[scope];
    if (counts[scope].hour >= hour || counts[scope].day >= day) return scope;
  }
  return null;
}

export interface ScanCounts {
  caller: { hour: number; day: number };
  client: { hour: number; day: number };
  global: { hour: number; day: number };
}

interface CountRow {
  caller_hour: number; caller_day: number;
  client_hour: number; client_day: number;
  global_hour: number; global_day: number;
}

/**
 * Every count in one query. SQLite's booleans are 1 and 0, so the six windows
 * are six conditional sums over the same day of rows — at most the global
 * daily cap of them, and that is the point of pruning at 24h.
 */
export async function countScans(
  db: D1Database, caller: string, client: string | null, now: number,
): Promise<ScanCounts> {
  const hourAgo = now - HOUR;
  const dayAgo = now - DAY;
  // A null client is a deployment with no `SCAN_IP_SALT`. The bucket is then
  // absent rather than shared: the sentinel matches no real key (those are 16
  // hex), and the count below is zeroed, so nobody lands behind a second and
  // much tighter global cap just because the salt was never set.
  const row = await db.prepare(`
    SELECT
      COALESCE(SUM(caller = ?1 AND at > ?3), 0) AS caller_hour,
      COALESCE(SUM(caller = ?1), 0)             AS caller_day,
      COALESCE(SUM(client = ?2 AND at > ?3), 0) AS client_hour,
      COALESCE(SUM(client = ?2), 0)             AS client_day,
      COALESCE(SUM(at > ?3), 0)                 AS global_hour,
      COUNT(*)                                  AS global_day
    FROM scan_hits WHERE at > ?4
  `).bind(caller, client ?? UNSALTED, hourAgo, dayAgo).first<CountRow>();
  return {
    caller: { hour: row?.caller_hour ?? 0, day: row?.caller_day ?? 0 },
    client: client === null ? { hour: 0, day: 0 } : { hour: row?.client_hour ?? 0, day: row?.client_day ?? 0 },
    global: { hour: row?.global_hour ?? 0, day: row?.global_day ?? 0 },
  };
}

/**
 * Book the scan, and drop what has aged out.
 *
 * Called *before* the upstream request, not after: a call that hangs, or a
 * photo Gemini refuses, has still been paid for. The prune rides along in the
 * same batch because it is the same round trip and there is no other moment
 * that reliably happens once per scan.
 */
export async function recordScan(
  db: D1Database, caller: string, client: string | null, now: number,
): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO scan_hits (at, caller, client) VALUES (?, ?, ?)")
      .bind(now, caller, client ?? UNSALTED),
    db.prepare("DELETE FROM scan_hits WHERE at <= ?").bind(now - DAY),
  ]);
}

/**
 * Is there a real browser behind this request?
 *
 * Everything above counts a caller who volunteers to be counted. Turnstile is
 * the one check a script cannot simply opt out of, and it is why the cheap
 * credential is survivable: a fresh id buys nothing without a fresh token, and
 * a token costs a browser.
 *
 * Verified server-side, before the image is streamed anywhere — a token the
 * client merely holds proves nothing.
 */
export async function turnstileOk(secret: string, token: string | null, ip: string): Promise<boolean> {
  if (!token) return false;
  const form = new URLSearchParams({ secret, response: token, remoteip: ip });
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!res.ok) return false;
    const body = await res.json<{ success?: unknown }>();
    return body.success === true;
  } catch {
    // Cloudflare's own endpoint being unreachable from a Cloudflare Worker is
    // not a verdict on the caller, but fail-open here would make the check
    // optional for anyone who can cause it — so it refuses.
    return false;
  }
}
