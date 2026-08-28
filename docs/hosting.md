# Hosting

*For: anyone deploying, or worrying about the bill.*

**Cloudflare, entirely free, with no realistic path to a bill at our scale.**
Decision and rejected alternatives:
[ADR-0001](decisions/0001-cloudflare-workers-d1-r2.md).

| Service | Role | Free tier |
|---|---|---|
| **Workers** | Serves the static app *and* the API from one script | 100k req/day, 10 ms CPU per invocation |
| **D1** | The op log (SQLite) | 5 GB, 5M row reads/day, 100k writes/day |
| **R2** | Receipt images | 10 GB, **zero egress fees** |
| Static Assets · custom domain | The Next.js export · a nice URL | included · free with DNS on Cloudflare |

We expect a few hundred requests/day and thousands of rows, ever. The decisive
property is **R2's zero egress** — this app is photo-heavy by design, and egress
is where object storage bills come from. (Limits verified mid-2026; re-check,
free tiers move.)

## Deploying

`apps/api` is the one Worker: static assets plus the sync API backed by D1.

```bash
pnpm --filter @hajsik/web build        # next build → apps/web/out
pnpm --filter @hajsik/api run deploy   # wrangler deploy
```

`wrangler.toml` binds `[assets] directory = "../web/out"` with
`not_found_handling = "404-page"` (**not** `single-page-application`: the export
is a real multi-page site, one HTML file per route), and a `[[d1_databases]]`
entry with `binding = "DB"`, `database_name = "hajsik"`, its `database_id`, and
`migrations_dir = "migrations"`.

**One-time, per Cloudflare account:**

```bash
cd apps/api
npx wrangler d1 create hajsik   # prints a database_id — paste into wrangler.toml
pnpm db:migrate                 # applies migrations to the remote DB
```

`pnpm db:migrate:local` does the same to `wrangler dev`'s local SQLite. Preview
deploys use a separate D1 — **never point a preview at production data**; the op
log has no infrastructure-level undo.

**Live at <https://hajsik.hajsik-api.workers.dev>** — permanent; `workers.dev`
subdomains don't expire while the Worker exists.

### The `CLOUDFLARE_API_TOKEN`

`wrangler deploy` needs it in the environment. It is **not** in this repo and
must never be committed. Expect the owner to paste a fresh one into the session
each time a deploy is needed; keep it in a scratch file outside anything
git-tracked. [standing-instructions.md](standing-instructions.md#workflow).

## Cost tripwires

Recognise these if you ever propose one:

- Storing full-resolution photos. Downscale to ~1600 px longest edge first
  (~4 MB → ~250 KB).
- Folding the op log server-side per request (10 ms CPU → paid plan).
- Polling every few seconds instead of on focus/reconnect (100k req/day).
- Durable Objects for real-time — cheap, but not free-tier-free.

## Gotchas

- **`pnpm --filter @hajsik/api deploy` does not run the package's `deploy`
  script** — `deploy` is one of pnpm's own commands. Say `run deploy`.
- Cloudflare env vars are runtime-only; anything needed during `next build`
  must come from the build environment, not Worker secrets.
- **`packages/core` imports siblings with a `.js` extension**, which is correct
  under `moduleResolution: "bundler"` and works in `tsc` and `next dev`, but
  Next's production webpack build fails with `Can't resolve './hlc.js'` unless
  `apps/web/next.config.mjs` sets `config.resolve.extensionAlias = { ".js":
  [".ts", ".tsx", ".js"] }`. **Run a real production build before assuming
  anything deploys** — `next dev` won't catch this.
