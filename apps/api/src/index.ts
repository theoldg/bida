import { Hono } from "hono";

/**
 * The one Worker that will eventually host both the static app and the
 * op-log API (see docs/hosting.md). For now it only serves the static
 * export — the Hono routes for sync (POST /ops, GET /ops, group
 * create/join) are Phase 3 work, not yet built.
 */
const app = new Hono<{ Bindings: { ASSETS: Fetcher } }>();

app.get("/api/health", (c) => c.json({ ok: true }));

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
