# 0001 — Cloudflare Workers + D1 + R2

**Status:** Accepted · 2026-08-27

## Context

Personal project, a handful of users, indefinite lifespan, and the owner's
requirement was "hosted super cheaply or for free". It stores receipt photos,
which is the part with a plausible route to a real bill.

## Decision

Host everything on Cloudflare: one Worker serving both the static app and the
Hono API, D1 for the operation log, R2 for images.

## Consequences

- £0/month with several orders of magnitude of headroom
  (100k req/day, 5 GB D1, 10 GB R2).
- **R2 charges nothing for egress**, which is the decisive property for an app
  that serves photos.
- One vendor, one dashboard, one `wrangler deploy`, one config file.
- No cold-pause, no idle timeout, no manual unpause.
- D1 is SQLite, so Postgres-specific features are unavailable. Accepted: an ORM
  with a dialect switch keeps the migration path open if it ever matters.
- The 10 ms free-tier CPU limit means the server can't do heavy work. This
  aligns with [0002](0002-append-only-op-log.md), where the server is
  deliberately stupid anyway.

## Rejected

- **Vercel Hobby + Neon** — free and pleasant, but three vendors, and Vercel
  Hobby is contractually personal, non-commercial, single-seat. A forced
  migration the day this stops being a toy.
- **Supabase** — the free tier pauses the whole project after 7 days idle and
  requires a manual unpause. Fatal for an app used in bursts around trips.
- **Fly.io / VPS** — ~£3–5/month and a machine to maintain, for no capability we
  need.
- **Firebase** — capable, but couples the data model to a vendor SDK, and the
  local-first design already provides what Firestore would be sold to us for.
