import { Hono } from "hono";
import {
  isCurrencyCode, rateFromNumber, validateSealedOp, SealError, type SealedOp,
} from "@bida/core";
import { bearerToken, sha256Hex } from "./auth";
import { acceptOps, ensureGroup, getGroup, opsSince } from "./store";

/**
 * The one Worker that hosts both the static app and the op-log sync API (see
 * docs/hosting.md). Sync is two endpoints, both under one group id and both
 * authenticated by a token the phone derives from the link secret — see
 * docs/sync.md. Ops arrive sealed and leave sealed: nothing in this file can
 * read one, by design (ADR-0036).
 */
const app = new Hono<{ Bindings: { ASSETS: Fetcher; DB: D1Database; GEMINI_API_KEY: string } }>();

app.get("/api/health", (c) => c.json({ ok: true }));

// Model id is a Worker-side constant, not client-supplied — see
// docs/receipt-scanning.md#why-the-key-sits-on-the-worker.
const GEMINI_MODEL = "gemini-3.1-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

app.post("/api/groups/:id/scan", async (c) => {
  const groupId = c.req.param("id");
  const token = bearerToken(c.req.header("Authorization") ?? null);
  if (!token) return c.json({ error: "missing bearer token" }, 401);

  const group = await getGroup(c.env.DB, groupId);
  if (!group) return c.json({ error: "unknown group" }, 404);
  if (group.token_hash !== (await sha256Hex(token))) return c.json({ error: "wrong token" }, 403);

  // Passthrough only: no parse, no re-serialize, so this never charges CPU
  // for the wait on Gemini. The client built the request body and will parse
  // the response — see apps/web/lib/scan/.
  const upstream = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "x-goog-api-key": c.env.GEMINI_API_KEY, "content-type": "application/json" },
    body: c.req.raw.body,
    // @ts-expect-error -- required by Workers to stream a request body through
    duplex: "half",
  });
  return new Response(upstream.body, { status: upstream.status });
});

app.post("/api/groups/:id/ops", async (c) => {
  const groupId = c.req.param("id");
  const token = bearerToken(c.req.header("Authorization") ?? null);
  if (!token) return c.json({ error: "missing bearer token" }, 401);

  const now = Date.now();
  const tokenHash = await sha256Hex(token);
  const group = await ensureGroup(c.env.DB, groupId, tokenHash, now);
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
  if (group.token_hash !== (await sha256Hex(token))) return c.json({ error: "wrong token" }, 403);

  const since = Number(c.req.query("since") ?? "0") || 0;
  const ops = await opsSince(c.env.DB, groupId, since);
  return c.json({ ops, latestSeq: group.last_op_seq });
});

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
