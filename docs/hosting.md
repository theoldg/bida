# Hosting

*For: anyone deploying, or worrying about the bill.*

**Cloudflare, entirely free, with no realistic path to a bill at our scale.**
Decision and rejected alternatives:
[ADR-0001](decisions/0001-cloudflare-workers-and-d1.md).

| Service | Role | Free tier |
|---|---|---|
| **Workers** | Serves the static app *and* the API from one script | 100k req/day, 10 ms CPU per invocation |
| **D1** | The op log (SQLite), sealed | 500 MB per database (5 GB account total), 5M row reads/day, 100k writes/day |
| Static Assets · custom domain | The Next.js export · a nice URL | included · free with DNS on Cloudflare |

We expect a few hundred requests/day and thousands of rows, ever. (Limits
verified 2026-08-30; re-check, free tiers move.) Nothing is stored outside D1;
receipt photos are not kept
([ADR-0001](decisions/0001-cloudflare-workers-and-d1.md)).

The one endpoint that spends actual money is the scan, and its budget is
[receipt-scanning.md](receipt-scanning.md#what-the-scan-costs).

**Treat this deployment as public.** The repo is public, bida.bid is being
advertised to users online, and its traffic is strangers' — so every ceiling on
this page is a threat surface and not only a capacity estimate. The numbers
above are what a *few hundred honest requests* need; what matters is what one
unfriendly caller can spend of them. Two endpoints take a body without
costing money and are therefore the ones to reason about: the scan, which has a
budget, and the push, which has ceilings on one request and, by decision rather
than by oversight, no counter across many
([sync.md](sync.md#the-push-has-a-ceiling)). The public repo also makes both
shapes readable, so read the reasoning there before proposing the counter
again.

## How full can it get

Every group shares the one `hajsik` database, nothing is ever deleted, and the
caps only ever move one way. Replaying realistic ops into
[the real schema](../apps/api/migrations/0001_init.sql) cost **~970 bytes per
op**, and a sealed op is roughly a third larger again (base64 over an IV and a
tag, minus the two indexes that are gone) — so **500 MB is a few hundred
thousand ops**. At the ~1.3 ops a lived-in expense ends up costing (the entry,
plus edits and the occasional delete), that is hundreds of thousands of
expenses, or thousands of trip-sized groups.

Nothing else comes close first. Pulls are incremental (`seq > ?`), so the 5M
daily row reads are unreachable; writes touch three rows per op (row + two
indexes), leaving ~30k ops/day, which is more entries than this app will see in
a year.

**What the log spends its bytes on is receipts.** Whole-entity ops
([ADR-0002](decisions/0002-append-only-op-log.md)) repeat every field on every
edit, which costs about 2.5x and is not the problem. An expense op carrying
`receiptItems` is four to five times the size of a plain one, and on a measured
database those ops were three quarters of every byte: editing a scanned bill's
title repeats its entire item array. Compaction, if it is ever wanted, is one
rule — drop superseded `receiptItems` from ops the fold has passed — and
nothing needs doing yet.

**So: no eviction strategy, and no near date for one.** At this project's real
scale — a few trips a year — 500 MB is centuries of use. It becomes a question
at roughly a thousand new groups a month; growth that fast would be the good
problem, and it arrives with warning. **Abuse would not.** A
caller writing deliberate garbage reaches the same ceiling without the warning,
which is why the push is capped at all
([sync.md](sync.md#the-push-has-a-ceiling)).

**Nothing expires and nothing sleeps.** D1 storage has no TTL, a Worker is not
paused or deleted for being idle, and a `workers.dev` subdomain lives as long as
its Worker — unlike free tiers that suspend a project after a week of quiet. The
only clock is **Time Travel: 7 days on the free plan** (30 paid), which is the
window for undoing a bad write at the infrastructure level and the reason an
export matters more than it looks.

## Deploying

`apps/api` is the one Worker: static assets plus the sync API backed by D1.

**Automatic:** every push runs
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) — build the
web export, then `wrangler deploy` at the branch's environment — using the
`CLOUDFLARE_API_TOKEN` repo secret (Settings → Secrets and variables →
Actions). It does not re-run typecheck/test; that's the local pre-push hook's
job (see [working agreements](../CLAUDE.md#working-agreements)), so a push that
skips the hook (`--no-verify`) can still deploy.

**Manually**, e.g. from a phone session with no local hook:

```bash
pnpm --filter @bida/web build            # next build → apps/web/out
pnpm --filter @bida/api run deploy:dev   # wrangler deploy --env dev
pnpm --filter @bida/api run deploy       # …or production, which is the owner's call
```

The scan endpoint needs three Worker secrets, once, not per deploy:

```bash
pnpm --filter @bida/api exec wrangler secret put GEMINI_API_KEY
pnpm --filter @bida/api exec wrangler secret put SCAN_IP_SALT        # any long random string
pnpm --filter @bida/api exec wrangler secret put TURNSTILE_SECRET_KEY
```

`GEMINI_API_KEY` is an **Agent Platform key from the Cloud project**, not an AI
Studio one: the shared path calls Vertex, and only the Vertex side can spend
Google Cloud credit ([receipt-scanning.md](receipt-scanning.md#why-the-shared-key-sits-on-the-worker)).
The two are not interchangeable and fail in opposite directions — an AI Studio
key on Vertex is `PERMISSION_DENIED`, ours on AI Studio is *blocked*.

**Set it on an environment only once that environment is running code that
calls Vertex.** The secret and the URL ship separately — the secret by hand,
the URL by deploy — so writing the new key to a Worker still serving the old
build breaks scanning there until the build catches up. Dev first, production
when `main` moves.

The last two are the scan budget
([receipt-scanning.md](receipt-scanning.md#what-the-scan-costs)) and both are
optional — without them the endpoint is unlimited. **Set
`TURNSTILE_SECRET_KEY` last**, after a deploy carrying the matching site key
(committed in `.github/workflows/deploy.yml`, since it is public and only
works on its own domains): a Worker checking for a token the app isn't sending
yet refuses every scan. Rotating `SCAN_IP_SALT` is free — it resets buckets
that live a day.

**Push notifications need a VAPID key pair per environment**
([notifications.md](notifications.md)); both of bida's Workers have theirs
(2026-09-23), so the commands below are for a new instance. The private half is a secret; the
public half is not, and goes in `wrangler.toml` as `VAPID_PUBLIC_KEY` under
that environment's `vars`, where the Worker signs with it and the app fetches
it to subscribe:

```bash
# prints `public …` and `private …`; once for dev, once for production
node -e "crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign']).then(async k=>{console.log('public ',Buffer.from(await crypto.subtle.exportKey('raw',k.publicKey)).toString('base64url'));console.log('private',(await crypto.subtle.exportKey('jwk',k.privateKey)).d)})"
pnpm --filter @bida/api exec wrangler secret put VAPID_PRIVATE_KEY --env dev   # dev's private half
pnpm --filter @bida/api exec wrangler secret put VAPID_PRIVATE_KEY             # production's
```

**Never rotate a VAPID key casually**: every subscription is bound to the
public key it was made with, so a new pair silences every phone until each
re-subscribes on its next start.

`wrangler.toml` binds `[assets] directory = "../web/out"` with
`not_found_handling = "404-page"` (**not** `single-page-application`: the export
is a real multi-page site, one HTML file per route), and a `[[d1_databases]]`
entry with `binding = "DB"`, `database_name = "hajsik"`, its `database_id`, and
`migrations_dir = "migrations"`.

Assets are served from the edge without waking the Worker, except for the two
paths `run_worker_first` names: `/api/*`, the sync API, and `/*.txt`, the RSC
payloads — one navigated to as a page is redirected to its route rather than
served as flight data
([frontend.md](frontend.md#pwa), `apps/api/src/payload.ts`). That list is
exhaustive, not additive (Gotcha below). The dev Worker sets
`run_worker_first = true` for its own reason — the DEV tint — and gets both
rules along with it.

**One-time, per Cloudflare account** (a fresh instance on someone else's
account is [SELFHOSTING.md](../SELFHOSTING.md)):

```bash
cd apps/api
npx wrangler d1 create hajsik   # prints a database_id — paste into wrangler.toml
pnpm db:migrate                 # applies migrations to the remote DB
```

`pnpm db:migrate:local` does the same to `wrangler dev`'s local SQLite, and
`pnpm db:migrate:dev` to the dev Worker's own remote database.

### Versions

**`major.semi.minor`, in the root `package.json`, and that is the only copy** —
the workspace packages are private and carry none. The web build inlines it
(`next.config.mjs`), `/about` stamps it in its top bar's corner and `/diag` prints it
as its first line, so a pasted report says which build it came from. `pnpm bump`, which
moves it to one past what `dev` is serving and is a no-op if it already is.

| Place | Who moves it | When |
|---|---|---|
| **minor** | Whoever pushes | Every push to `dev`, because every push deploys. `pnpm bump` |
| **semi** | Whoever is working, on their own judgement | The app is meaningfully a different thing than it was: a screen that wasn't there, a rule that changed. `pnpm bump semi`, and say so in the summary |
| **major** | **The owner, in words, in a session** | Never on anybody else's judgement. `pnpm bump major` refuses |

Nobody has to remember the first row: `pnpm check` fails a tree that differs
from what `dev` is serving and still calls itself the same number
([testing.md](testing.md)). It is the last place that can catch it, since CI
clones shallow and has no `dev` to compare against.

A release moves no number. `main` only ever fast-forwards `dev`, so production
shows whatever number the commit it lands on was built with, and the dev Worker
has already served that exact build.

### Dev and production

Two Workers, two D1 databases, one repo. The differences are the name, the
`database_id` and a `BIDA_ENV = "dev"` var — the [`[env.dev]` block in
`wrangler.toml`](../apps/api/wrangler.toml) restates them, and the web export
is byte-identical, so what production gets is a build that already ran on dev.
So dev can't be mistaken for production on a phone, the dev Worker dresses that
same export on the way out ([`dev-env.ts`](../apps/api/src/dev-env.ts)): it
serves the DEV-stamped icons `pnpm icons` writes to `public/dev/` at the
ordinary icon URLs, and tags HTML `data-env="dev"`, which turns the
balance colours blue and orange. An already-installed dev app keeps its old home-screen icon until it is
reinstalled.

| | Branch | Worker | D1 | Holds |
|---|---|---|---|---|
| **Production** | `main` | `hajsik` | `hajsik` | Somebody's ledger. Never wiped. |
| **Dev** | `dev` | `hajsik-dev` | `hajsik-dev` | Disposable. Wipe it freely. |

**A group link is same-origin** — `https://<worker-host>/g/<id>#key`, and the
app syncs against the host it was loaded from. So these are two sealed worlds
with no flag to get wrong: a group made on dev can only ever reach `hajsik-dev`,
and the production log is unreachable from a dev session. That, not care, is
what keeps ["never wipe it again"](standing-instructions.md#product) true.

**`main` only ever fast-forwards.** Nothing is committed to it, so it is a
pointer at what production is serving, and releasing is the owner's — a button
on github.com → Actions → **Release dev to main** → *Run workflow*
([`release.yml`](../.github/workflows/release.yml)), which needs no laptop and
no token. By hand it is the same two commands:

```bash
git checkout main && git merge --ff-only dev && git push && git checkout dev
```

`--ff-only` is the rail, not a formality: it refuses exactly when something
landed on `main` behind the branch's back, and the fix is `git merge main` from
`dev` once before releasing again. Because it holds, the branches never diverge,
there is no merge commit and nothing is ever merged *back*. Merging does not
consume `dev` — it keeps moving and is released again, as often as you like.

**Worker secrets are per-environment**, and dev has all three — a scan works
there, gate and budget included. One Turnstile widget
serves both: its domain list names each hostname, which is why the same site key
can ship in both builds. **Dev's scan budget is counted in dev's own database**,
so the global daily cap — the one number bounding the Gemini bill
([receipt-scanning.md](receipt-scanning.md#what-the-scan-costs)) — now exists
twice, and the worst case is two of them.

### A schema change, from here on

**The database is finished, and wiping it is not on the table**
([standing-instructions.md](standing-instructions.md#product)). What is in D1
is somebody's ledger, and there is no other copy but the phones'.

So a schema change is **a new numbered migration that keeps what is there** —
`0002_*.sql`, then `0003_*.sql`. [`0001_init.sql`](../apps/api/migrations/0001_init.sql)
has been applied and is history: editing it changes nothing on the live
database (`d1_migrations` records it as done) while quietly disagreeing with
what is actually there, which is worse than either. Reach for `ALTER TABLE`,
or a new table beside the old one.

**Applying it is not part of the deploy.** `deploy.yml` builds and deploys and
never runs migrations, so `pnpm db:migrate` has to be run by hand — with a
token the owner pastes — in the same window as the push that needs it. Migrate
first when the new code requires the new shape, and write migrations that an
older Worker survives, because for a minute or two one will be serving them.

**Live at <https://bida.bid>** — a custom domain bound to the `hajsik`
Worker, which also answers on <https://hajsik.hajsik-api.workers.dev>. Dev is
<https://hajsik-dev.hajsik-api.workers.dev>. All three are permanent;
`workers.dev` subdomains don't expire while the Worker exists. **Production has
two hostnames, and anything keyed to an origin has to name `bida.bid`** — the
one people actually open. A Turnstile widget naming only the `workers.dev`
host refuses every scan on `bida.bid`.

The Worker and the D1 database are called `hajsik`, the project's old name, and
they keep those names. A Worker's name *is* its hostname, and a
group is a secret link to that hostname ([ADR-0003](decisions/0003-link-only-access.md)):
rename it and every link anyone has shared points at nothing. Renaming the D1
is worse — it creates an empty database beside the live one. Whatever the app
is called, these two names are addresses, not branding. A real `bida.` domain
is the way to change what people see; that is a redirect, not a rename.

### The `CLOUDFLARE_API_TOKEN`

`wrangler deploy` needs it in the environment. It lives as the
`CLOUDFLARE_API_TOKEN` GitHub Actions repo secret, used by
[`deploy.yml`](../.github/workflows/deploy.yml) — it is **not** in the repo
itself and must never be committed. A manual deploy from a session still needs
the owner to paste a fresh token; keep it in a scratch file outside anything
git-tracked, never in a git-tracked one.
[standing-instructions.md](standing-instructions.md#workflow).

## Cost tripwires

Recognise these if you ever propose one:

- Sending a full-resolution photo to the scan. It is downscaled on the phone
  first — ≤1024 px long edge, ≤200 KB
  ([receipt-scanning.md](receipt-scanning.md#the-shape)) — and the Worker
  refuses a body past `MAX_IMAGE_BYTES`.
- Folding the op log server-side per request (10 ms CPU → paid plan).
- Polling every few seconds instead of on focus/reconnect (100k req/day).
- Durable Objects for real-time — cheap, but not free-tier-free.
- Raising `SCAN_LIMITS.global` without doing the arithmetic: it is the only
  number that bounds the Gemini bill, at roughly $0.001 a scan
  ([receipt-scanning.md](receipt-scanning.md#what-the-scan-costs)). A hard
  project quota under it was declined — the owner watches the spend with
  billing alerts of their own, so the counter is the brake and they are the
  watch on it. Don't re-propose the quota; do keep the arithmetic honest.

## Gotchas

- **A Google Cloud budget does not stop spend.** It emails while the meter
  runs; capping for real needs a billing-export → Pub/Sub → function that
  disables the billing account. `SCAN_LIMITS.global` is the only hard brake we
  have, and it is the better one — it fails as a refusal with a sentence
  rather than as a dead key. The owner runs alerts on the account beside it
  and takes the residual risk knowingly.
- **A key that validates is not a key that works.** `checkGeminiKey`
  (`web/lib/scan/key.ts`) asks Google's free `models` list, which answers 200
  for a key with no credit and no permission — exactly what a funded-looking
  key with an empty prepay balance does before refusing every scan. The list
  proves the key is a key and that this browser can reach Google, and nothing
  about whether a scan will be paid for.
- **A Turnstile widget's secret is readable back**, at `GET
  /accounts/:id/challenges/widgets/:sitekey` — it is in the response beside the
  domains. So a second Worker reuses the widget without rotating anything, and
  rotating (which would break production until its secret is replaced too) is
  never the way to get a key you already own. Editing one is `PUT`, sending the
  whole widget back — `PATCH` answers 10405 on an account token.
- **A push made with the built-in `GITHUB_TOKEN` triggers no workflow.** This
  is deliberate on GitHub's part (it stops a loop), and it is why
  `release.yml` calls `deploy.yml` itself instead of pushing `main` and
  trusting the push trigger to notice.
- **Wrangler environments inherit nothing.** `[env.dev]` restates `[assets]`
  and the D1 binding in full; a block left out is simply absent from that
  Worker, with no warning at deploy time.
- **`run_worker_first` as a list names everything the Worker handles.** Unset,
  anything without a matching asset falls through to the Worker; the moment it
  is a list, everything unnamed is the asset worker's, and with
  `not_found_handling = "404-page"` that means the 404 page. Adding `/*.txt`
  without `/api/*` beside it 404s the entire sync API — and neither `wrangler
  deploy` nor a build says a word. `wrangler dev` and one `curl /api/health`
  does.
- **`wrangler deploy --dry-run` succeeds with a bogus `database_id`** — it does
  not validate the id against the account. Only a real deploy (or `wrangler d1
  list`) catches a wrong one.
- **`wrangler d1 execute --file` prints a summary, not rows.** It reports
  queries executed and rows read and swallows the `SELECT` output, `--json` or
  not. To actually read something back, pass the SQL as `--command`.
- **A Cloudflare token scoped for Workers only fails D1 calls** with a generic
  `Authentication error [code: 10000]`. `wrangler whoami` succeeding proves
  nothing; the token needs "D1 - Edit" specifically.
- **`pnpm --filter @bida/api deploy` does not run the package's `deploy`
  script** — `deploy` is one of pnpm's own commands. Say `run deploy`.
- Cloudflare env vars are runtime-only; anything needed during `next build`
  must come from the build environment, not Worker secrets.
- **`packages/core` imports siblings with a `.js` extension**, which is correct
  under `moduleResolution: "bundler"` and works in `tsc` and `next dev`, but
  Next's production webpack build fails with `Can't resolve './hlc.js'` unless
  `apps/web/next.config.mjs` sets `config.resolve.extensionAlias = { ".js":
  [".ts", ".tsx", ".js"] }`. **Run a real production build before assuming
  anything deploys** — `next dev` won't catch this.
