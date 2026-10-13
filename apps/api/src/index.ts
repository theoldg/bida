// Doc: docs/hosting.md
import { Hono, type Context } from "hono";
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
import { pastDay } from "./rate-day";
import { pageForPayload } from "./payload";
import {
  fetchRegistry, isClientKey, isTricountKey, MAX_REGISTRY_BYTES, openSession,
} from "./tricount";
import {
  acceptOps, deleteGroup, ensureGroup, getGroup, isDeleted, pullPage, type GroupRow,
} from "./store";
import { parseNotify, relay } from "./relay";

/** Ops arrive and leave sealed; nothing here can read one (ADR-0036). */
type Env = {
  Bindings: {
    ASSETS: Fetcher;
    DB: D1Database;
    GEMINI_API_KEY: string;
    TURNSTILE_SECRET_KEY?: string;
    SCAN_IP_SALT?: string;
    BIDA_ENV?: string;
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
  };
};

const app = new Hono<Env>();

app.get("/api/health", (c) => c.json({ ok: true }));

/**
 * Asked at runtime: one static build serves both Workers, each with its own pair.
 */
app.get("/api/push/key", (c) => {
  if (!c.env.VAPID_PUBLIC_KEY) return c.json({ error: "no push on this server" }, 404);
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
});

/**
 * Before the token: the tombstone keeps none, and a 403 would send somebody
 * hunting for a new invite.
 */
const GONE = { error: "this group was deleted", scope: "deleted" } as const;

async function authorizedGroup(c: Context<Env>, groupId: string): Promise<GroupRow | Response> {
  const token = bearerToken(c.req.header("Authorization") ?? null);
  if (!token) return c.json({ error: "missing bearer token" }, 401);

  const group = await getGroup(c.env.DB, groupId);
  if (!group) return c.json({ error: "unknown group" }, 404);
  if (isDeleted(group)) return c.json(GONE, 410);
  if (group.token_hash !== (await sha256Hex(token))) return c.json({ error: "wrong token" }, 403);
  return group;
}

async function jsonBody<T extends object>(c: Context<Env>): Promise<T | Response> {
  try {
    return await c.req.json<T>();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
}

/**
 * A CDN 404ing a path is this feed's actual failure mode, hence a fallback host.
 */
function rateHosts(date: string | null): { host: string; dated: boolean }[] {
  const latest = [
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1",
    "https://latest.currency-api.pages.dev/v1",
  ].map((host) => ({ host, dated: false }));
  if (!date) return latest;
  return [
    { host: `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1`, dated: true },
    { host: `https://${date}.currency-api.pages.dev/v1`, dated: true },
    ...latest,
  ];
}

app.get("/api/rates/:from/:to", async (c) => {
  const from = c.req.param("from").toUpperCase();
  const to = c.req.param("to").toUpperCase();
  if (!isCurrencyCode(from) || !isCurrencyCode(to)) {
    return c.json({ error: "from and to must be three-letter currency codes" }, 400);
  }
  if (from === to) return c.json({ from, to, rate: "1", asOf: null });
  const date = pastDay(c.req.query("date"), Date.now());

  for (const { host, dated } of rateHosts(date)) {
    let payload: { date?: unknown; [key: string]: unknown };
    try {
      const upstream = await fetch(`${host}/currencies/${from.toLowerCase()}.json`, {
        cf: { cacheTtl: dated ? 604800 : 21600, cacheEverything: true },
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
 * The prompt and schema are ours (`scan-body.ts`); the bill is streamed, never
 * held.
 */
app.post("/api/groups/:id/scan", async (c) => {
  const groupId = c.req.param("id");
  const group = await authorizedGroup(c, groupId);
  if (group instanceof Response) return group;

  const ip = c.req.header("cf-connecting-ip") ?? "";

  if (c.env.TURNSTILE_SECRET_KEY) {
    const verified = await turnstileOk(
      c.env.TURNSTILE_SECRET_KEY, c.req.header("x-turnstile-token") ?? null, ip,
    );
    if (!verified) return c.json({ error: "unverified browser", scope: "turnstile" }, 403);
  }

  // Counted, booked, then spent, so a hung call is still paid for.
  const now = Date.now();
  const client = c.env.SCAN_IP_SALT ? await clientKey(ip, c.env.SCAN_IP_SALT) : null;
  const full = overLimit(await countScans(c.env.DB, groupId, client, now));
  if (full) return c.json({ error: `${full} scan limit reached`, scope: full }, 429);
  await recordScan(c.env.DB, groupId, client, now);

  const medium: ScanMedium = c.req.header("x-input") === "text" ? "text" : "photo";

  const declared = Number(c.req.header("content-length") ?? NaN);
  if (!Number.isFinite(declared)) return c.json({ error: "content-length required" }, 411);
  if (declared > MAX_BYTES[medium]) return c.json({ error: "bill too large" }, 413);

  const bill = c.req.raw.body;
  if (!bill) return c.json({ error: "no bill" }, 400);

  const tone: ScanTone = c.req.header("x-stas") === "1" ? "stas" : "kind";

  // Non-base64 is found mid-stream, but `fetch` may already have resolved — hence
  // `refusal`, checked on both paths.
  const refusal: { err: NotBase64Error | null } = { err: null };
  let upstream: Response;
  try {
    upstream = await fetch(VERTEX_URL, {
      method: "POST",
      headers: { "x-goog-api-key": c.env.GEMINI_API_KEY, "content-type": "application/json" },
      body: wrapPayload(
        bill, (err) => { refusal.err = err; }, tone, medium, new Date().toISOString().slice(0, 10),
      ),
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

/** A POST so the tricount's secret is never in a URL. */
app.post("/api/tricount", async (c) => {
  const body = await jsonBody<{ key?: unknown; clientKey?: unknown }>(c);
  if (body instanceof Response) return body;
  if (!isTricountKey(body.key)) return c.json({ error: "not a tricount link" }, 400);
  if (!isClientKey(body.clientKey)) return c.json({ error: "not a client key" }, 400);

  const appId = crypto.randomUUID();
  let session: Awaited<ReturnType<typeof openSession>>;
  try {
    session = await openSession(body.clientKey, appId);
  } catch {
    session = null;
  }
  if (!session) return c.json({ error: "tricount would not open a session", scope: "down" }, 502);

  let upstream: Response;
  try {
    upstream = await fetchRegistry(session, body.key, appId);
  } catch {
    return c.json({ error: "tricount did not answer", scope: "down" }, 502);
  }
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
  if (isDeleted(group)) return c.json(GONE, 410);
  if (group.token_hash !== tokenHash) return c.json({ error: "wrong token" }, 403);

  const oversized = declaredTooLarge(c.req.header("content-length") ?? null);
  if (oversized) return c.json({ error: oversized.error }, oversized.status);

  const body = await jsonBody<{ ops?: unknown; since?: unknown }>(c);
  if (body instanceof Response) return body;
  if (!Array.isArray(body.ops)) return c.json({ error: "ops must be an array" }, 400);
  const since = typeof body.since === "number" ? body.since : 0;

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

  const tooLarge = pushTooLarge(incoming);
  if (tooLarge) return c.json({ error: tooLarge.error }, tooLarge.status);

  const { assigned, latestSeq } = await acceptOps(c.env.DB, groupId, incoming, since, now);
  const pushedIds = new Set(incoming.map((op) => op.id));
  const page = await pullPage(c.env.DB, groupId, since, Math.max(latestSeq, group.last_op_seq));

  // `latestSeq` is the page's end, never the group's: a build from before paging
  // takes it as its cursor, and so walks the log a page per sync.
  return c.json({
    assigned,
    ops: page.ops.filter((op) => !pushedIds.has(op.id)),
    latestSeq: page.upTo,
    more: page.more,
  });
});

/** Never registers a group, unlike `POST /ops`. */
app.post("/api/groups/:id/notify", async (c) => {
  const groupId = c.req.param("id");
  const group = await authorizedGroup(c, groupId);
  if (group instanceof Response) return group;

  const oversized = declaredTooLarge(c.req.header("content-length") ?? null, MAX_NOTIFY_BODY_BYTES);
  if (oversized) return c.json({ error: oversized.error }, oversized.status);

  const body = await jsonBody<{ notifications?: unknown }>(c);
  if (body instanceof Response) return body;
  const notifications = parseNotify(body.notifications);
  if (!Array.isArray(notifications)) return c.json({ error: notifications.error }, notifications.status);

  const vapid = c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_KEY
    ? { publicKey: c.env.VAPID_PUBLIC_KEY, privateKey: c.env.VAPID_PRIVATE_KEY }
    : null;
  const notified = await relay(notifications, vapid, new URL(c.req.url).origin, Date.now());
  return c.json({ notified });
});

app.get("/api/groups/:id/ops", async (c) => {
  const groupId = c.req.param("id");
  const group = await authorizedGroup(c, groupId);
  if (group instanceof Response) return group;

  const since = Number(c.req.query("since") ?? "0") || 0;
  const page = await pullPage(c.env.DB, groupId, since, group.last_op_seq);
  return c.json({ ops: page.ops, latestSeq: page.upTo, more: page.more });
});

app.delete("/api/groups/:id", async (c) => {
  const groupId = c.req.param("id");
  const group = await authorizedGroup(c, groupId);
  if (group instanceof Response) return group;

  await deleteGroup(c.env.DB, groupId, Date.now());
  return c.json({ deleted: true });
});

app.all("*", (c) => {
  const page = pageForPayload(c.req.raw);
  if (page) return c.redirect(page, 302);
  return c.env.BIDA_ENV === "dev" ? devAsset(c.env.ASSETS, c.req.raw) : c.env.ASSETS.fetch(c.req.raw);
});

export default app;
