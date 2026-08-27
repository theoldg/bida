# Hosting

*For: anyone deploying, or worrying about the bill.*

**Answer: Cloudflare, entirely free, with no realistic path to a bill at our
scale.** Decision and rejected alternatives in
[ADR-0001](decisions/0001-cloudflare-workers-d1-r2.md).

## What we use

| Service | Role | Free tier | Our expected use |
|---|---|---|---|
| **Workers** | Serves the static app *and* the API from one script | 100,000 req/day, 10 ms CPU per invocation | A few hundred req/day |
| **D1** | The op log (SQLite) | 5 GB storage, 5M row reads/day, 100k row writes/day | Thousands of rows, ever |
| **R2** | Receipt images | 10 GB storage, 1M Class A + 10M Class B ops/month, **zero egress fees** | Hundreds of MB |
| **Workers Static Assets** | The Next.js export | Included with Workers | — |
| Custom domain | | Free with a domain on Cloudflare DNS | |

Limits verified mid-2026 — [Workers/D1/R2 pricing](https://developers.cloudflare.com/workers/platform/pricing/).
Re-check before assuming; free tiers move.

The one that actually matters is **R2's zero egress**. This app is photo-heavy
by design, and egress is where object storage bills come from. On S3, receipts
would be the only line item with a plausible route to real money.

## Why not the obvious alternatives

| Option | Why not |
|---|---|
| **Vercel Hobby + Neon** | Works, and free. But three vendors instead of one, and Vercel Hobby is contractually **personal, non-commercial, single-seat**. Fine today, a forced migration if this ever becomes anything |
| **Supabase** | Free tier **pauses the entire project after 7 days of inactivity** (tightened Feb 2026) and needs a manual unpause from the dashboard. For an app used in bursts around trips, that is disqualifying — you'd open it at dinner and find it dead |
| **Fly.io / a small VPS** | ~£3–5/month and a machine to patch, back up, and be woken by |
| **Firebase** | Would work well; ties the data model to a vendor SDK, and the local-first design already gives us what Firestore would be sold to us for |

## Deploying

*To be filled in when `apps/api` exists. Expected shape:*

```bash
pnpm build              # next build → static export into the worker's assets dir
pnpm wrangler d1 migrations apply hajsik --remote
pnpm wrangler deploy
```

One `wrangler.toml`, one Worker, D1 and R2 as bindings. Preview deploys use a
separate D1 database — **never point a preview at production data**; the op log
has no undo at the infrastructure level.

## Cost tripwires

Things that would actually cost money, so you recognise them if you ever propose
one:

- Storing full-resolution photos. Downscale on-device to ~1600 px longest edge
  before upload; a 12 MP phone photo is ~4 MB, a downscaled one ~250 KB.
- Folding the op log on the server per request (10 ms CPU limit → paid plan).
- Polling every few seconds instead of on focus/reconnect (100k req/day).
- Durable Objects for real-time. Deliberately deferred; they're cheap but not
  free-tier-free in the same way.

## Gotchas

*Add to this list every time one bites you.*

- Cloudflare env vars are runtime-only; Next.js may want some at build time.
  Anything needed during `next build` must come from the CI environment, not
  from Worker secrets.
- `@opennextjs/cloudflare` is the adapter you'd need **if** we ever move off
  static export. We don't use it — see
  [ADR-0004](decisions/0004-static-export-fragment-routing.md).
