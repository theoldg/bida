import { Hono } from "hono";
import {
  VERTEX_URL, isCurrencyCode, rateFromNumber, validateSealedOp, SealError, type SealedOp,
} from "@bida/core";
import { bearerToken, sha256Hex } from "./auth";
import { MAX_IMAGE_BYTES, NotAnImageError, type ScanTone, wrapImage } from "./scan-body";
import { clientKey, countScans, overLimit, recordScan, turnstileOk } from "./scan-limits";
import { devAsset } from "./dev-env";
import { pageForPayload } from "./payload";
import { acceptOps, deleteGroup, ensureGroup, getGroup, isDeleted, opsSince } from "./store";

/**
 * The one Worker that hosts both the static app and the op-log sync API (see
 * docs/hosting.md). Sync is two endpoints, both under one group id and both
 * authenticated by a token the phone derives from the link secret — see
 * docs/sync.md. Ops arrive sealed and leave sealed: nothing in this file can
 * read one, by design (ADR-0036).
 */
const app = new Hono<{
  Bindings: {
    ASSETS: Fetcher;
    DB: D1Database;
    GEMINI_API_KEY: string;
    /** Both optional, and a deployment without them is the old unlimited one —
     *  see docs/receipt-scanning.md#what-the-scan-costs and SELFHOSTING.md. */
    TURNSTILE_SECRET_KEY?: string;
    SCAN_IP_SALT?: string;
    /** `"dev"` on the dev Worker only (wrangler.toml) — see dev-env.ts. */
    BIDA_ENV?: string;
  };
}>();

app.get("/api/health", (c) => c.json({ ok: true }));

/**
 * 410 for a group that was deleted on request (`/delete-my-data`), and it is
 * asked *before* the token, unlike every other refusal here: the tombstone
 * keeps no token to compare, and a 403 would send somebody looking for a fresh
 * invite link to a group that no longer exists. `scope` is what lets a phone
 * say "this group was deleted" rather than "sync is failing".
 */
const GONE = { error: "this group was deleted", scope: "deleted" } as const;

/**
 * Today's rate for one currency pair, for the group's rate registry.
 *
 * `@fawazahmed0/currency-api` — CC0, no key, no rate limit, ~340 currencies
 * including the MAD and UZS that rule the ECB-backed feeds out, one file per
 * currency, updated daily. jsDelivr is the primary host and the project's own
 * Pages deployment the fallback, because a CDN that 404s a path is the failure
 * mode this feed actually has.
 *
 * Fetched **by the entry's currency**, not by the group's base: the feed
 * publishes `currencies/mad.json` with a `.eur` in it, which *is* the rate a
 * MAD entry needs. Asking for the base and reciprocating would put every rate
 * through a division nobody asked for.
 *
 * Behind our own endpoint rather than called from the phone, for the reasons
 * the scan passthrough is: one cache for everyone, no CORS or service-worker
 * fight, and swapping the feed later touches this file and no client. It
 * answers in our own shape for the same reason. Unauthenticated on purpose —
 * the data is public, the input is two three-letter codes, and unlike the scan
 * it spends no money.
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
      // Cloudflare's edge cache IS the shared cache — no KV, no D1, no cron,
      // no new binding. Six hours on a feed that moves once a day.
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
      // The one door the feed's floats come in through, and it closes behind
      // them: everything downstream of here is the decimal string.
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
 * Read a receipt. The body is the photo, base64, and nothing else.
 *
 * The prompt and the response schema are ours (`scan-body.ts`), so the only
 * thing a caller decides is which image Gemini reads — this is a receipt
 * reader, not our API key behind an open prompt. The image is streamed into
 * the envelope rather than read, so the Worker still parses no body and holds
 * no photo; what it costs is one table lookup per byte, and the reason it is
 * worth that is in `wrapImage`.
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

  // Asked before anything that costs a D1 round trip, because it is the check
  // a script cannot opt out of and therefore the one worth failing on first.
  if (c.env.TURNSTILE_SECRET_KEY) {
    const verified = await turnstileOk(
      c.env.TURNSTILE_SECRET_KEY, c.req.header("x-turnstile-token") ?? null, ip,
    );
    if (!verified) return c.json({ error: "unverified browser", scope: "turnstile" }, 403);
  }

  // Counted, then booked, then spent — in that order, so a call that hangs or
  // a photo the model refuses has still been paid for. `scope` is what tells
  // the phone which sentence to print; without it a 429 of ours is
  // indistinguishable from Gemini's own, which means something else entirely.
  const now = Date.now();
  const client = c.env.SCAN_IP_SALT ? await clientKey(ip, c.env.SCAN_IP_SALT) : null;
  const full = overLimit(await countScans(c.env.DB, groupId, client, now));
  if (full) return c.json({ error: `${full} scan limit reached`, scope: full }, 429);
  await recordScan(c.env.DB, groupId, client, now);

  // Asked of the header first because it is the one check that costs nothing
  // and the only one that can refuse a body before it is streamed anywhere.
  // `wrapImage` counts the bytes too, for the caller whose header lies.
  const declared = Number(c.req.header("content-length") ?? NaN);
  if (!Number.isFinite(declared)) return c.json({ error: "content-length required" }, 411);
  if (declared > MAX_IMAGE_BYTES) return c.json({ error: "image too large" }, 413);

  const image = c.req.raw.body;
  if (!image) return c.json({ error: "no image" }, 400);

  // Staś mode: the phone asks for the meaner of the two refusal paragraphs
  // (`scan-body.ts`). A header, because it is the one thing about the prompt a
  // caller gets to move — and it moves by picking an envelope we hold, not by
  // sending a word of one, so the promise above is untouched.
  const tone: ScanTone = c.req.header("x-stas") === "1" ? "stas" : "kind";

  // A body that isn't base64 is only found mid-stream, by which time the
  // request to Gemini is open. Refusing truncates it, so what upstream gets is
  // an unterminated JSON string and never the caller's bytes — but it is not
  // an exception we can rely on catching: `fetch` resolves once the *response
  // headers* arrive, so a body that errors after that resolves rather than
  // rejects. Hence `refusal`, checked on both paths: it is set before the
  // throw that truncates the request, so it cannot lose the race with a reply.
  const refusal: { err: NotAnImageError | null } = { err: null };
  let upstream: Response;
  try {
    upstream = await fetch(VERTEX_URL, {
      method: "POST",
      headers: { "x-goog-api-key": c.env.GEMINI_API_KEY, "content-type": "application/json" },
      body: wrapImage(image, (err) => { refusal.err = err; }, tone),
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

app.post("/api/groups/:id/ops", async (c) => {
  const groupId = c.req.param("id");
  const token = bearerToken(c.req.header("Authorization") ?? null);
  if (!token) return c.json({ error: "missing bearer token" }, 401);

  const now = Date.now();
  const tokenHash = await sha256Hex(token);
  const group = await ensureGroup(c.env.DB, groupId, tokenHash, now);
  // The tombstone is what makes a deletion stick: this is the push that would
  // otherwise re-register the id and upload the group again from a phone that
  // still holds the link (store.ts).
  if (isDeleted(group)) return c.json(GONE, 410);
  if (group.token_hash !== tokenHash) return c.json({ error: "wrong token" }, 403);

  let body: { ops?: unknown; since?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.ops)) return c.json({ error: "ops must be an array" }, 400);
  const since = typeof body.since === "number" ? body.since : 0;

  // The envelope is all there is to check. What an op *says* is sealed, so
  // there is no server-side validation of it left — and a client that pushed
  // nonsense would only be lying to its own group.
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

  const { assigned, latestSeq } = await acceptOps(c.env.DB, groupId, incoming, now);
  const pushedIds = new Set(incoming.map((op) => op.id));
  const pulled = (await opsSince(c.env.DB, groupId, since)).filter((op) => !pushedIds.has(op.id));

  return c.json({ assigned, ops: pulled, latestSeq });
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
 * Delete a group: every sealed op, and the group down to a tombstone.
 *
 * Reached only from `/delete-my-data` (docs/frontend.md#deleting-a-group),
 * which is the app's answer to "the hosted service has no way to ask for a
 * group to be deleted". There is nothing to ask *us* for: the link is the
 * authority here as everywhere else, so the phone holding it does it itself,
 * with the same derived bearer it syncs with.
 *
 * Nothing about this is soft. The ops are gone from D1 when this returns, the
 * id can never be written to again, and no other copy of the log exists on this
 * server. What the screen warns about is exactly that.
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
  // Before the asset: a phone that has been handed an RSC payload URL as a
  // page gets the page instead of a screenful of `1:"$Sreact.fragment"`.
  // See payload.ts — it is the service worker's rule, for the phones that
  // have no service worker yet.
  const page = pageForPayload(c.req.raw);
  if (page) return c.redirect(page, 302);
  return c.env.BIDA_ENV === "dev" ? devAsset(c.env.ASSETS, c.req.raw) : c.env.ASSETS.fetch(c.req.raw);
});

export default app;
