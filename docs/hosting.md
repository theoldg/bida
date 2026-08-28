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

`apps/api` is the one Worker. It serves the static assets *and*, as of Phase
3, the sync API (`POST`/`GET /api/groups/:id/ops`) backed by D1:

```bash
pnpm --filter @hajsik/web build        # next build → apps/web/out (static export)
pnpm --filter @hajsik/api run deploy   # wrangler deploy, serves apps/web/out + API
```

`apps/api/wrangler.toml`:

```toml
name = "hajsik"
main = "src/index.ts"
compatibility_date = "2026-08-27"

[assets]
directory = "../web/out"
binding = "ASSETS"
not_found_handling = "404-page"

[[d1_databases]]
binding = "DB"
database_name = "hajsik"
database_id = "..."          # from `wrangler d1 create hajsik`, one-time
migrations_dir = "migrations"
```

`src/index.ts` is a Hono app: the two sync routes, `/api/health`, and
everything else passed through to the `ASSETS` binding.
`not_found_handling = "404-page"` (not `"single-page-application"`): the
export is a real multi-page static site, one HTML file per route (see
[ADR-0007](decisions/0007-per-screen-routes-not-drawers.md)), not a
client-router SPA that should fall back to `index.html` for unknown paths.

### One-time: creating the D1 database

Only needs doing once, ever, per Cloudflare account:

```bash
cd apps/api
npx wrangler d1 create hajsik        # prints a database_id — paste it into wrangler.toml
pnpm db:migrate                      # applies migrations/0001_init.sql to the remote DB
```

`pnpm db:migrate:local` applies the same migration to `wrangler dev`'s local
SQLite instead, for local API testing without touching production data.

### The `CLOUDFLARE_API_TOKEN`

`wrangler deploy` needs a Cloudflare API token in the environment
(`export CLOUDFLARE_API_TOKEN=...`) — it is **not** stored in this repo and
must never be committed, even to a private one; see
[standing-instructions.md](standing-instructions.md#the-owner-pastes-the-cloudflare-token-each-session).
The owner's preferred way to set the environment variable persistently is the
Claude Code environment settings UI, which isn't reachable from a phone — so
for now, expect the token to be pasted into the session by hand each time a
deploy is needed. Keep it in a session-local scratch file (outside the repo,
outside anything git-tracked), never in a tracked file or a commit.

**Live at <https://hajsik.hajsik-api.workers.dev>** — a permanent URL, no
custom domain needed to get one; `workers.dev` subdomains don't expire as long
as the Worker exists.

When D1 and R2 land in Phase 3, add them as bindings in the same
`wrangler.toml` and this section grows a migrations step:

```bash
pnpm wrangler d1 migrations apply hajsik --remote
```

Preview deploys use a separate D1 database — **never point a preview at
production data**; the op log has no undo at the infrastructure level.

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

- **`pnpm --filter @hajsik/api deploy` does not run the package's `deploy`
  script.** `deploy` is one of pnpm's own commands, so pnpm takes the word for
  itself and fails with `ERR_PNPM_INVALID_DEPLOY_TARGET: This command requires
  one parameter`. Say `run deploy` explicitly.
- Cloudflare env vars are runtime-only; Next.js may want some at build time.
  Anything needed during `next build` must come from the CI environment, not
  from Worker secrets.
- `@opennextjs/cloudflare` is the adapter you'd need **if** we ever move off
  static export. We don't use it — see
  [ADR-0004](decisions/0004-static-export-fragment-routing.md).
- `packages/core` imports its own siblings with a `.js` extension (e.g.
  `./hlc.js`), which is correct under `tsconfig.base.json`'s
  `moduleResolution: "bundler"` and resolves fine under `tsc` and `next dev` —
  but Next's production webpack build does **not** map `.js` imports back to
  `.ts` files on its own, and fails with `Module not found: Can't resolve
  './hlc.js'`. Fixed in `apps/web/next.config.mjs` with
  `config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] }` inside a
  `webpack()` hook. This only shows up on `next build`, not `next dev` — run a
  real production build at least once before assuming the app deploys.
