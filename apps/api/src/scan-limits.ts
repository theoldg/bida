// Doc: docs/scan-worker.md#what-the-scan-costs
import { SCAN_LIMITS, type ScanLimitScope } from "@bida/core";

const UNSALTED = "unsalted";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** HMAC'd: a bare sha256 of an IPv4 is rainbow-tabled in minutes. */
export async function clientKey(ip: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  return [...new Uint8Array(mac)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function overLimit(counts: ScanCounts): ScanLimitScope | null {
  for (const scope of ["global", "client", "caller"] as const) {
    const { hour, day } = SCAN_LIMITS[scope];
    if (counts[scope].hour >= hour || counts[scope].day >= day) return scope;
  }
  return null;
}

interface ScanCounts {
  caller: { hour: number; day: number };
  client: { hour: number; day: number };
  global: { hour: number; day: number };
}

interface CountRow {
  caller_hour: number; caller_day: number;
  client_hour: number; client_day: number;
  global_hour: number; global_day: number;
}

export async function countScans(
  db: D1Database, caller: string, client: string | null, now: number,
): Promise<ScanCounts> {
  const hourAgo = now - HOUR;
  const dayAgo = now - DAY;
  // No salt: the client bucket is absent, not a second global cap.
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

/** Before the upstream request, so a hang or refusal is still paid for. */
export async function recordScan(
  db: D1Database, caller: string, client: string | null, now: number,
): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO scan_hits (at, caller, client) VALUES (?, ?, ?)")
      .bind(now, caller, client ?? UNSALTED),
    db.prepare("DELETE FROM scan_hits WHERE at <= ?").bind(now - DAY),
  ]);
}

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
    // Fail-open would make the check optional for anyone able to cause it.
    return false;
  }
}
