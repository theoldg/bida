import { Hono } from "hono";
import { validateOp, OpValidationError, type Op } from "@hajsik/core";
import { bearerSecret, sha256Hex } from "./auth";
import { acceptOps, ensureGroup, getGroup, opsSince } from "./store";

/**
 * The one Worker that hosts both the static app and the op-log sync API (see
 * docs/hosting.md). Sync is two endpoints, both under one group id and both
 * authenticated by the group secret as a bearer token — see docs/sync.md.
 */
const app = new Hono<{ Bindings: { ASSETS: Fetcher; DB: D1Database } }>();

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/groups/:id/ops", async (c) => {
  const groupId = c.req.param("id");
  const secret = bearerSecret(c.req.header("Authorization") ?? null);
  if (!secret) return c.json({ error: "missing bearer secret" }, 401);

  const now = Date.now();
  const secretHash = await sha256Hex(secret);
  const group = await ensureGroup(c.env.DB, groupId, secretHash, now);
  if (group.secret_hash !== secretHash) return c.json({ error: "wrong secret" }, 403);

  let body: { ops?: unknown; since?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.ops)) return c.json({ error: "ops must be an array" }, 400);
  const since = typeof body.since === "number" ? body.since : 0;

  let incoming: Op[];
  try {
    incoming = body.ops.map((o) => {
      const op = validateOp(o);
      if (op.groupId !== groupId) throw new OpValidationError("op.groupId doesn't match the route");
      return op;
    });
  } catch (err) {
    if (err instanceof OpValidationError) return c.json({ error: err.message }, 400);
    throw err;
  }

  const { assigned, latestSeq } = await acceptOps(c.env.DB, groupId, incoming);
  const pushedIds = new Set(incoming.map((op) => op.id));
  const pulled = (await opsSince(c.env.DB, groupId, since)).filter((op) => !pushedIds.has(op.id));

  return c.json({ assigned, ops: pulled, latestSeq });
});

app.get("/api/groups/:id/ops", async (c) => {
  const groupId = c.req.param("id");
  const secret = bearerSecret(c.req.header("Authorization") ?? null);
  if (!secret) return c.json({ error: "missing bearer secret" }, 401);

  const group = await getGroup(c.env.DB, groupId);
  if (!group) return c.json({ error: "unknown group" }, 404);
  if (group.secret_hash !== (await sha256Hex(secret))) return c.json({ error: "wrong secret" }, 403);

  const since = Number(c.req.query("since") ?? "0") || 0;
  const ops = await opsSince(c.env.DB, groupId, since);
  return c.json({ ops, latestSeq: group.last_op_seq });
});

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
