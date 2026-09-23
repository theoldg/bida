import { Hono } from "hono";
import {
  VERTEX_URL, isCurrencyCode, rateFromNumber, validateSealedOp, SealError, type SealedOp,
} from "@bida/core";
import { bearerToken, sha256Hex } from "./auth";
import {
  MAX_BYTES, NotBase64Error, type ScanMedium, type ScanTone, wrapPayload,
} from "./scan-body";
import { clientKey, countScans, overLimit, recordScan, turnstileOk } from "./scan-limits";
import { MAX_NOTIFY_BODY_BYTES, declaredTooLarge, pushTooLarge } from "./push-limits";
import { devAsset } from "./dev-env";
import { pageForPayload } from "./payload";
import {
  fetchRegistry, isClientKey, isTricountKey, MAX_REGISTRY_BYTES, openSession,
} from "./tricount";
import { acceptOps, deleteGroup, ensureGroup, getGroup, isDeleted, opsSince } from "./store";
import { parseNotify, relay } from "./relay";

/**
 * The one Worker: static app plus the sync API (docs/hosting.md, docs/sync.md).
 * Ops arrive and leave sealed; nothing here can read one (ADR-0036).
 */
const app = new Hono<{
  Bindings: {
    ASSETS: Fetcher;
    DB: D1Database;
    GEMINI_API_KEY: string;
    /** Both optional; without them scans are unlimited — docs/receipt-scanning.md#what-the-scan-costs, SELFHOSTING.md. */
    TURNSTILE_SECRET_KEY?: string;
    SCAN_IP_SALT?: string;
    /** `"dev"` on the dev Worker only (wrangler.toml) — see dev-env.ts. */
    BIDA_ENV?: string;
    /** wrangler.toml; the private half is a secret. Without it nothing is relayed — docs/hosting.md#deploying. */
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
  };
}>();

app.get("/api/health", (c) => c.json({ ok: true }));

/**
 * The VAPID public key a phone subscribes with. Asked at runtime, not built in:
 * one static build serves both Workers, and each has its own pair
 * (docs/hosting.md#deploying). 404 on a Worker with none, which hides the offer.
 */
app.get("/api/push/key", (c) => {
  if (!c.env.VAPID_PUBLIC_KEY) return c.json({ error: "no push on this server" }, 404);
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
});

/**
 * 410 for a group deleted on request (`/delete-my-data`), checked *before* the
 * token: the tombstone keeps none, and a 403 would send somebody hunting for a
 * new invite. `scope` lets the phone say "deleted" rather than "sync failing".
 */
const GONE = { error: "this group was deleted", scope: "deleted" } as const;

/**
 * Today's rate for one currency pair, for the rate registry.
 *
 * `@fawazahmed0/currency-api`: CC0, keyless, ~340 currencies (including MAD
 * and UZS, which ECB feeds lack), daily. jsDelivr first, the project's Pages
 * as fallback — a CDN 404ing a path is this feed's actual failure mode.
 *
 * Fetched **by the entry's currency** (`currencies/mad.json` has `.eur`), so no
 * reciprocal is taken. Proxied for one shared cache, no CORS fight, and one
 * place to swap feeds. Unauthenticated: public data, costs nothing.
 */
const RATE_HOSTS = [
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1",
  "https://latest.currency-api.pages.dev/v1",
];

app.get("/api/rates/:from/:to", async (c) => {
  const from = c.req.param("from").toUpperCase();
  const to = c.req.param("to").toUpperCase();
  if (!isCurrencyCode(from) || !isCurrencyCode(to)) {
    return c.json({ error: "from and to must be three-letter currency codes" }, 400);
  }
  if (from === to) return c.json({ from, to, rate: "1", asOf: null });

  for (const host of RATE_HOSTS) {
    let payload: { date?: unknown; [key: string]: unknown };
    try {
      // The edge cache is the shared cache. Six hours on a daily feed.
      const upstream = await fetch(`${host}/currencies/${from.toLowerCase()}.json`, {
        cf: { cacheTtl: 21600, cacheEverything: true },
      });
      if (!upstream.ok) continue;
      payload = await upstream.json();
    } catch {
      continue;
    }
    const table = payload[from.toLowerCase()];
    const value = typeof table === "object" && table !== null
      ? (table as Record<string, unknown>)[to.toLowerCase()]
      : undefined;
    if (typeof value !== "number") continue;
    let rate: string;
    try {
      // The one door floats come in through; downstream is the decimal string.
      rate = rateFromNumber(value);
    } catch {
      continue;
    }
    const asOf = typeof payload["date"] === "string" ? payload["date"] : null;
    return c.json({ from, to, rate, asOf }, 200, {
      "cache-control": "public, max-age=21600",
    });
  }
  return c.json({ error: `no rate for ${from} to ${to}` }, 502);
});

/**
 * Read a bill: the body is the bill in base64 — a photo, or typed text with
 * `X-Input: text`. The prompt and schema are ours (`scan-body.ts`); a caller
 * picks only the bill and one of four envelopes. The bill is streamed, never
 * parsed or held; see `wrapPayload`.
 */
app.post("/api/groups/:id/scan", async (c) => {
  const groupId = c.req.param("id");
  const token = bearerToken(c.req.header("Authorization") ?? null);
  if (!token) return c.json({ error: "missing bearer token" }, 401);

  const group = await getGroup(c.env.DB, groupId);
  if (!group) return c.json({ error: "unknown group" }, 404);
  if (isDeleted(group)) return c.json(GONE, 410);
  if (group.token_hash !== (await sha256Hex(token))) return c.json({ error: "wrong token" }, 403);

  const ip = c.req.header("cf-connecting-ip") ?? "";

  // First, before any D1 round trip: the one check a script can't opt out of.
  if (c.env.TURNSTILE_SECRET_KEY) {
    const verified = await turnstileOk(
      c.env.TURNSTILE_SECRET_KEY, c.req.header("x-turnstile-token") ?? null, ip,
    );
    if (!verified) return c.json({ error: "unverified browser", scope: "turnstile" }, 403);
  }

  // Counted, booked, then spent, so a hung call or a refused photo is still paid
  // for. `scope` separates our 429 from Gemini's.
  const now = Date.now();
  const client = c.env.SCAN_IP_SALT ? await clientKey(ip, c.env.SCAN_IP_SALT) : null;
  const full = overLimit(await countScans(c.env.DB, groupId, client, now));
  if (full) return c.json({ error: `${full} scan limit reached`, scope: full }, 429);
  await recordScan(c.env.DB, groupId, client, now);

  // Same act and budget; only the envelope and size cap differ.
  const medium: ScanMedium = c.req.header("x-input") === "text" ? "text" : "photo";

  // The free check, and the only one that can refuse before streaming.
  // `wrapPayload` counts bytes too, for a lying header.
  const declared = Number(c.req.header("content-length") ?? NaN);
  if (!Number.isFinite(declared)) return c.json({ error: "content-length required" }, 411);
  if (declared > MAX_BYTES[medium]) return c.json({ error: "bill too large" }, 413);

  const bill = c.req.raw.body;
  if (!bill) return c.json({ error: "no bill" }, 400);

  // Staś mode picks the meaner refusal paragraph — one of our envelopes, never
  // caller words.
  const tone: ScanTone = c.req.header("x-stas") === "1" ? "stas" : "kind";

  // Non-base64 is found mid-stream, after the Gemini request is open; refusing
  // truncates it, so upstream gets broken JSON, never the caller's bytes. But
  // `fetch` resolves once response headers arrive, so the error may not reject —
  // hence `refusal`, set before the truncating throw and checked on both paths.
  const refusal: { err: NotBase64Error | null } = { err: null };
  let upstream: Response;
  try {
    upstream = await fetch(VERTEX_URL, {
      method: "POST",
      headers: { "x-goog-api-key": c.env.GEMINI_API_KEY, "content-type": "application/json" },
      body: wrapPayload(bill, (err) => { refusal.err = err; }, tone, medium),
      // @ts-expect-error -- required by Workers to stream a request body through
      duplex: "half",
    });
  } catch (err) {
    if (refusal.err) return c.json({ error: refusal.err.message }, 400);
    throw err;
  }
  if (refusal.err) return c.json({ error: refusal.err.message }, 400);
  return new Response(upstream.body, { status: upstream.status });
});

/**
 * The JSON behind a tricount link, for **Import a group**
 * (docs/data-model.md#reading-a-tricount-back). Proxied because bunq's API sends
 * no CORS header; the handshake is in `tricount.ts`. Unauthenticated like
 * `/api/rates`: it spends no key of ours. Not a general proxy — both fields are
 * shape-checked and the host is compiled in.
 *
 * **A POST so the tricount's secret is never in a URL**, which everything logs.
 * The ledger is streamed back unread.
 */
app.post("/api/tricount", async (c) => {
  let body: { key?: unknown; clientKey?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!isTricountKey(body.key)) return c.json({ error: "not a tricount link" }, 400);
  if (!isClientKey(body.clientKey)) return c.json({ error: "not a client key" }, 400);

  const appId = crypto.randomUUID();
  let session: Awaited<ReturnType<typeof openSession>>;
  try {
    session = await openSession(body.clientKey, appId);
  } catch {
    session = null;
  }
  // No session means bunq refused us (an undocumented API's failure mode),
  // distinct from "no such tricount", which is the person's link to fix.
  if (!session) return c.json({ error: "tricount would not open a session", scope: "down" }, 502);

  let upstream: Response;
  try {
    upstream = await fetchRegistry(session, body.key, appId);
  } catch {
    return c.json({ error: "tricount did not answer", scope: "down" }, 502);
  }
  // Our own shape, so the phone never reads bunq's wording.
  if (!upstream.ok) return c.json({ error: "no tricount for that link", scope: "unknown" }, 404);

  const declared = Number(upstream.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_REGISTRY_BYTES) {
    return c.json({ error: "that tricount is too big to import" }, 413);
  }
  return new Response(upstream.body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

app.post("/api/groups/:id/ops", async (c) => {
  const groupId = c.req.param("id");
  const token = bearerToken(c.req.header("Authorization") ?? null);
  if (!token) return c.json({ error: "missing bearer token" }, 401);

  const now = Date.now();
  const tokenHash = await sha256Hex(token);
  const group = await ensureGroup(c.env.DB, groupId, tokenHash, now);
  // Without this a phone still holding the link would re-register the id and
  // re-upload the group (store.ts).
  if (isDeleted(group)) return c.json(GONE, 410);
  if (group.token_hash !== tokenHash) return c.json({ error: "wrong token" }, 403);

  // Free, so first. Abuse ceilings, not protocol limits (push-limits.ts).
  const oversized = declaredTooLarge(c.req.header("content-length") ?? null);
  if (oversized) return c.json({ error: oversized.error }, oversized.status);

  let body: { ops?: unknown; since?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.ops)) return c.json({ error: "ops must be an array" }, 400);
  const since = typeof body.since === "number" ? body.since : 0;

  // Only the envelope can be checked; the content is sealed.
  let incoming: SealedOp[];
  try {
    incoming = body.ops.map((o) => {
      const op = validateSealedOp(o);
      if (op.groupId !== groupId) throw new SealError("op.groupId doesn't match the route");
      return op;
    });
  } catch (err) {
    if (err instanceof SealError) return c.json({ error: err.message }, 400);
    throw err;
  }

  // `content-length` is the caller's claim; this is the count.
  const tooLarge = pushTooLarge(incoming);
  if (tooLarge) return c.json({ error: tooLarge.error }, tooLarge.status);

  const { assigned, latestSeq } = await acceptOps(c.env.DB, groupId, incoming, now);
  const pushedIds = new Set(incoming.map((op) => op.id));
  const pulled = (await opsSince(c.env.DB, groupId, since)).filter((op) => !pushedIds.has(op.id));

  return c.json({ assigned, ops: pulled, latestSeq });
});

/**
 * Relay notifications the sending phone encrypted to other phones
 * (docs/notifications.md, `relay.ts`). Its own route so a group of any size is
 * batches of `MAX_NOTIFY_PER_BATCH`, each with its own subrequest budget. Sent
 * after the push that caused them has landed, so none announces an op the log
 * lacks. **Never registers a group**, unlike `POST /ops`: an unknown one is 404.
 */
app.post("/api/groups/:id/notify", async (c) => {
  const groupId = c.req.param("id");
  const token = bearerToken(c.req.header("Authorization") ?? null);
  if (!token) return c.json({ error: "missing bearer token" }, 401);

  const group = await getGroup(c.env.DB, groupId);
  if (!group) return c.json({ error: "unknown group" }, 404);
  if (isDeleted(group)) return c.json(GONE, 410);
  if (group.token_hash !== (await sha256Hex(token))) return c.json({ error: "wrong token" }, 403);

  const oversized = declaredTooLarge(c.req.header("content-length") ?? null, MAX_NOTIFY_BODY_BYTES);
  if (oversized) return c.json({ error: oversized.error }, oversized.status);

  let body: { notifications?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const notifications = parseNotify(body.notifications);
  if (!Array.isArray(notifications)) return c.json({ error: notifications.error }, notifications.status);

  const vapid = c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_KEY
    ? { publicKey: c.env.VAPID_PUBLIC_KEY, privateKey: c.env.VAPID_PRIVATE_KEY }
    : null;
  // Awaited rather than `waitUntil`: the sender needs the statuses.
  const notified = await relay(notifications, vapid, new URL(c.req.url).origin, Date.now());
  return c.json({ notified });
});

app.get("/api/groups/:id/ops", async (c) => {
  const groupId = c.req.param("id");
  const token = bearerToken(c.req.header("Authorization") ?? null);
  if (!token) return c.json({ error: "missing bearer token" }, 401);

  const group = await getGroup(c.env.DB, groupId);
  if (!group) return c.json({ error: "unknown group" }, 404);
  if (isDeleted(group)) return c.json(GONE, 410);
  if (group.token_hash !== (await sha256Hex(token))) return c.json({ error: "wrong token" }, 403);

  const since = Number(c.req.query("since") ?? "0") || 0;
  const ops = await opsSince(c.env.DB, groupId, since);
  return c.json({ ops, latestSeq: group.last_op_seq });
});

/**
 * Delete a group: every sealed op, and the group to a tombstone. Reached from
 * `/delete-my-data` (docs/frontend.md#deleting-a-group); the link is the
 * authority, so the phone holding it does it with its usual bearer. Not soft:
 * the ops are gone when this returns and the id can never be written again.
 */
app.delete("/api/groups/:id", async (c) => {
  const groupId = c.req.param("id");
  const token = bearerToken(c.req.header("Authorization") ?? null);
  if (!token) return c.json({ error: "missing bearer token" }, 401);

  const group = await getGroup(c.env.DB, groupId);
  if (!group) return c.json({ error: "unknown group" }, 404);
  if (isDeleted(group)) return c.json(GONE, 410);
  if (group.token_hash !== (await sha256Hex(token))) return c.json({ error: "wrong token" }, 403);

  await deleteGroup(c.env.DB, groupId, Date.now());
  return c.json({ deleted: true });
});

app.all("*", (c) => {
  // Before the asset: a phone handed an RSC payload URL as a page gets the page,
  // not `1:"$Sreact.fragment"` — the service worker's rule, for phones without
  // one yet (payload.ts).
  const page = pageForPayload(c.req.raw);
  if (page) return c.redirect(page, 302);
  return c.env.BIDA_ENV === "dev" ? devAsset(c.env.ASSETS, c.req.raw) : c.env.ASSETS.fetch(c.req.raw);
});

export default app;
