# 0001 — Cloudflare Workers + D1

**Status:** Accepted · 2026-08-27 · R2 dropped 2026-09-05

**Context.** Personal project, a handful of users, indefinite lifespan, and the
owner's requirement was "hosted super cheaply or for free".

**Decision.** Everything on Cloudflare: one Worker serving both the static app
and the Hono API, D1 for the op log.

R2 was part of this decision while receipt photos were going to be stored — its
zero egress was the reason — and left with them
([product.md](../product.md#deliberately-not-in-the-mvp)). There is no bucket
and no binding. Storing photos means adding one back, not a new ADR.

## Consequences

- £0/month with orders of magnitude of headroom
  ([hosting.md](../hosting.md#how-full-can-it-get)).
- One vendor, one `wrangler deploy`. No cold-pause, no idle timeout.
- D1 is SQLite, so Postgres-specific features are out. Accepted.
- The 10 ms free-tier CPU limit means the server can't do heavy work, which
  aligns with [0002](0002-append-only-op-log.md)'s deliberately stupid server.

## Rejected

- **Vercel Hobby + Neon** — free and pleasant, but three vendors, and Hobby is
  contractually personal, non-commercial, single-seat: a forced migration the
  day this stops being a toy.
- **Supabase** — the free tier pauses the whole project after 7 days idle and
  needs a manual unpause. Fatal for an app used in bursts around trips.
- **Fly.io / VPS** — ~£3–5/month and a machine to maintain, for no capability we
  need.
- **Firebase** — couples the data model to a vendor SDK, and local-first already
  gives us what Firestore would be sold to us for.
