# Hosting

*For: anyone deploying, or worrying about the bill.*

**Cloudflare, entirely free, with no realistic path to a bill at our scale.**
Decision and rejected alternatives:
[ADR-0001](decisions/0001-cloudflare-workers-d1-r2.md).

| Service | Role | Free tier |
|---|---|---|
| **Workers** | Serves the static app *and* the API from one script | 100k req/day, 10 ms CPU per invocation |
| **D1** | The op log (SQLite) | 500 MB per database (5 GB account total), 5M row reads/day, 100k writes/day |
| **R2** | Receipt images | 10 GB, **zero egress fees** |
| Static Assets · custom domain | The Next.js export · a nice URL | included · free with DNS on Cloudflare |

We expect a few hundred requests/day and thousands of rows, ever. The decisive
property is **R2's zero egress** — this app is photo-heavy by design, and egress
is where object storage bills come from. (Limits verified 2026-08-30; re-check,
free tiers move.)

**Actual usage, 2026-09-11:** 676 kB of D1 against the 500 MB limit, 47 groups,
678 ops — and ~3.6k row reads a day against 5M. Three orders of magnitude of
headroom on every axis. What the log spends it on is in
[implementation-status.md](implementation-status.md).

### How full can it get

Every group shares the one `hajsik` database, and nothing is ever deleted, so
the caps only ever move one way. Replaying realistic ops into
[the real schema](../apps/api/migrations/0001_init.sql) costs **~970 bytes per
op**, indexes included, so **500 MB is about 515k ops**. At the ~1.3 ops a
lived-in expense ends up costing (the entry, plus edits and the occasional
delete) that is:

| | Fills 500 MB |
|---|---|
| Expenses | ~380,000 |
| Typical trip groups (5 people, 50 expenses, ~71 KB) | ~7,000 |
| Heavy groups (200 expenses, ~270 KB) | ~1,900 |

Nothing else comes close first. Pulls are incremental (`seq > ?`), so the 5M
daily row reads are unreachable; writes touch three rows per op (row + two
indexes), leaving ~30k ops/day, which is more entries than this app will see in
a year. **R2 is the cap that actually bites**: 10 GB at the ≤200 KB a receipt is
downscaled to ([receipt-scanning.md](receipt-scanning.md)) is ~50,000 photos, so
once more than about one expense in eight carries one, receipts run out of room
before the op log does.

**So: no eviction strategy, and no near date for one.** At this project's real
scale — a few trips a year — 500 MB is centuries of use. It becomes a question
only at roughly a thousand new groups a month, i.e. only if this stops being an
app for its owner's friends. If that day comes the lever is receipts (R2 first,
and old photos are the disposable part), not the op log, which is the thing a
group's link is promising to still hold.

**Nothing expires and nothing sleeps.** D1 storage has no TTL, a Worker is not
paused or deleted for being idle, and a `workers.dev` subdomain lives as long as
its Worker — unlike free tiers that suspend a project after a week of quiet. The
only clock is **Time Travel: 7 days on the free plan** (30 paid), which is the
window for undoing a bad write at the infrastructure level and the reason an
export matters more than it looks.

## Deploying

`apps/api` is the one Worker: static assets plus the sync API backed by D1.

**Automatic:** every push to `main` runs
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) — build the
web export, then `wrangler deploy` — using the `CLOUDFLARE_API_TOKEN` repo
secret (Settings → Secrets and variables → Actions). It does not re-run
typecheck/test; that's the local pre-push hook's job (see
[working agreements](../CLAUDE.md#working-agreements)), so a push that skips
the hook (`--no-verify`) can still deploy.

**Manually**, e.g. from a phone session with no local hook:

```bash
pnpm --filter @hajsik/web build        # next build → apps/web/out
pnpm --filter @hajsik/api run deploy   # wrangler deploy
```

The scan endpoint needs one Worker secret, once, not per deploy:

```bash
pnpm --filter @hajsik/api exec wrangler secret put GEMINI_API_KEY
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

`wrangler deploy` needs it in the environment. Since 2026-08-28 it lives as the
`CLOUDFLARE_API_TOKEN` GitHub Actions repo secret, used by
[`deploy.yml`](../.github/workflows/deploy.yml) — it is **not** in the repo
itself and must never be committed. A manual deploy from a session still needs
the owner to paste a fresh token; keep it in a scratch file outside anything
git-tracked, never in a git-tracked one.
[standing-instructions.md](standing-instructions.md#workflow).

## Cost tripwires

Recognise these if you ever propose one:

- Storing full-resolution photos. Downscale to ~1600 px longest edge first
  (~4 MB → ~250 KB).
- Folding the op log server-side per request (10 ms CPU → paid plan).
- Polling every few seconds instead of on focus/reconnect (100k req/day).
- Durable Objects for real-time — cheap, but not free-tier-free.

## Gotchas

- **`wrangler deploy --dry-run` succeeds with a bogus `database_id`** — it does
  not validate the id against the account. Only a real deploy (or `wrangler d1
  list`) catches a wrong one.
- **`wrangler d1 execute --file` prints a summary, not rows.** It reports
  queries executed and rows read and swallows the `SELECT` output, `--json` or
  not. To actually read something back, pass the SQL as `--command`.
- **A Cloudflare token scoped for Workers only fails D1 calls** with a generic
  `Authentication error [code: 10000]`. `wrangler whoami` succeeding proves
  nothing; the token needs "D1 - Edit" specifically.
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
