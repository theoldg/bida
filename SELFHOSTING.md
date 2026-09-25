# Self-hosting bida

Everything runs on one Cloudflare Worker: the static app, the sync API, and a
D1 database holding the op log. On the free tier this costs nothing and needs
no card. Receipt scanning is the one part that spends money, and it is
optional.

You need a Cloudflare account, Node 22+, and pnpm.

## Deploy

```bash
git clone https://github.com/theoldg/bida.git && cd bida
pnpm install
```

Pick a name for the Worker. It becomes the hostname —
`<name>.<your-subdomain>.workers.dev` — and a group in this app is a secret
link to that hostname, so **renaming later breaks every link already shared**.
Choose it now. Edit `apps/api/wrangler.toml`: set `name`, and set
`database_name` to whatever you want the database called.

Every `wrangler` command below talks to your account and has to authenticate.
Interactively that is once, in a browser:

```bash
cd apps/api
npx wrangler login        # OAuth; stored in ~/.wrangler
npx wrangler whoami       # confirms which account you're on
```

With no browser — a container, a remote shell — export an API token instead.
Same variable CI uses, same scopes as [below](#deploying-on-push):

```bash
export CLOUDFLARE_API_TOKEN=...   # never commit it; keep it out of the repo
```

Create the database and paste the id it prints back into `wrangler.toml`:

```bash
npx wrangler d1 create <database_name>   # prints database_id
npx wrangler d1 migrations apply <database_name> --remote
```

`db:migrate` in `apps/api/package.json` has the original database name hardcoded;
change it or keep using `wrangler` directly.

Build the web export and deploy:

```bash
pnpm --filter @bida/web build        # → apps/web/out
pnpm --filter @bida/api run deploy   # wrangler deploy
```

(`pnpm --filter @bida/api deploy` runs pnpm's own `deploy`, not the script. Say
`run deploy`.)

That's the whole install. There are no environment variables on the web side —
the app talks to its own origin — and no accounts, signup, or admin state to
configure.

## Deploying on push

`.github/workflows/deploy.yml` builds and deploys on every push to `main` (the
production Worker) and to `dev` (a second Worker and D1 that this repo's own
deployment keeps — [hosting.md](docs/hosting.md#dev-and-production)). A fork
wanting only one world drops `dev` from the trigger and the `[env.dev]` block
from `wrangler.toml`. It needs a `CLOUDFLARE_API_TOKEN` repo secret (Settings →
Secrets and variables → Actions). Create it under My Profile → API Tokens →
Create Custom Token with **Account → Workers Scripts: Edit** and **Account → D1: Edit**; a token missing
D1 fails with a generic `Authentication error [code: 10000]`, and `wrangler
whoami` succeeding proves nothing about that. `wrangler` reads the variable
straight out of the environment, so the same token works for a manual deploy.

The workflow does not run migrations and does not run tests. Migrations are
yours to apply by hand, in the same window as the push that needs them. Tests
run in the `pre-push` hook, which `pnpm install` wires up.

## Receipt scanning

`POST /api/groups/:id/scan` proxies to Gemini on Vertex AI using a Worker secret:

```bash
pnpm --filter @bida/api exec wrangler secret put GEMINI_API_KEY
```

That is an API key from a Google Cloud project with Vertex AI enabled — **not**
an AI Studio key, which Vertex refuses with `PERMISSION_DENIED`
([docs/hosting.md](docs/hosting.md#deploying)). Set it once, not per deploy.
Without it the scan button fails and the rest of the app is unaffected.

You can also skip it entirely: each person can paste their own Gemini key under
**Advanced**, and a phone that has one calls Google directly and never asks your
Worker to scan anything
([docs/scan-worker.md](docs/scan-worker.md#a-key-of-your-own)). A
deployment for a handful of people who each bring a key needs no `GEMINI_API_KEY`,
no Turnstile and no budget at all.

Scanning is the one thing here that costs money, so it has a budget — the
numbers, and the reasoning, are in
[docs/scan-worker.md](docs/scan-worker.md#what-the-scan-costs). Two
more secrets turn its two halves on, and **both are optional: without them the
endpoint is unlimited**, which is what you want only behind an address you
don't advertise.

```bash
pnpm --filter @bida/api exec wrangler secret put SCAN_IP_SALT         # any long random string
pnpm --filter @bida/api exec wrangler secret put TURNSTILE_SECRET_KEY
```

`SCAN_IP_SALT` keys the one-way hash of the caller's address, so the per-address
limit works without your database ever holding an IP. `TURNSTILE_SECRET_KEY` is
the secret half of a [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)
widget; the public half is `NEXT_PUBLIC_TURNSTILE_SITE_KEY` at build time, and
`.github/workflows/deploy.yml` carries **this** instance's, which will not work
on your domain — put yours there. **Set the Worker secret last**, after
deploying a build that carries your site key: a Worker looking for a token the
app isn't sending refuses every scan.

Without Turnstile the remaining limits are honest but voluntary: registering a
fresh group id is one unauthenticated request by design (it is how a quick
split mints its credential), so a caller who doesn't want a per-caller budget
brings another id. What still holds is the per-address limit and the global
daily cap, which is the one that bounds your bill.

The same door writes ops into D1 with no cap, which matters more on a public
instance than on the numbers in [docs/hosting.md](docs/hosting.md#how-full-can-it-get).

## Push notifications

`wrangler.toml` carries **this** instance's `VAPID_PUBLIC_KEY` under `[vars]`
and `[env.dev.vars]`, and its private half is nobody's but ours. Either delete
those lines — a Worker with no public key answers `/api/push/key` with 404 and
the app never offers notifications — or make a pair of your own and put
`VAPID_PRIVATE_KEY` as a Worker secret; the one-line generator is in
[docs/hosting.md](docs/hosting.md#deploying).

## Local development

```bash
pnpm --filter @bida/web dev          # Next dev server, no Worker
cd apps/api && npx wrangler dev      # Worker + local D1 against apps/web/out
```

`wrangler dev` serves the last build in `apps/web/out`, so build first if you
want the real thing. `pnpm --filter @bida/api db:migrate:local` seeds the local
SQLite. Worker secrets in local dev come from `apps/api/.dev.vars`, which is
gitignored.

Exchange rates come from a public CC0 feed through `/api/rates/:from/:to` and
need no key.

## Renaming it

The licence is MIT, but the name *bida* and the logo are not covered — they stay
with the author. If you publish an instance, rename it. The visible name is in
`apps/web/lib/copy.ts` (`name`, plus a few strings that spell it out),
`apps/web/public/manifest.webmanifest`, and the icons — `design/brand/logo.svg`
is the master, and `pnpm icons` regenerates the PNGs in `apps/web/public/` from
it.

The internal names — the IndexedDB database, the `bida.theme` key — are stable
identifiers, not branding. Changing them orphans existing data on people's
phones.

## What you're signing up for

- Nothing is deleted from the op log except a whole group, by someone holding
  its link at `/delete-my-data`; there is no admin panel.
  [docs/hosting.md](docs/hosting.md) does the arithmetic on when 500 MB runs
  out.
- D1's only infrastructure-level undo is Time Travel: 7 days on the free plan.
- The server cannot read a group's data — it is encrypted on the phone
  ([ADR-0036](docs/decisions/0036-the-server-cannot-read-a-group.md)). That also
  means you cannot recover anything for a user who loses their link, and neither
  can they.
