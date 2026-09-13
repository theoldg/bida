# Self-hosting bida

Everything runs on one Cloudflare Worker: the static app, the sync API, and a
D1 database holding the op log. On the free tier this costs nothing and needs
no card. Receipt scanning is the one part that spends money, and it is
optional.

You need a Cloudflare account, Node 22+, and pnpm.

## Deploy

```bash
git clone https://github.com/theoldg/money.git bida && cd bida
pnpm install
```

Pick a name for the Worker. It becomes the hostname —
`<name>.<your-subdomain>.workers.dev` — and a group in this app is a secret
link to that hostname, so **renaming later breaks every link already shared**.
Choose it now. Edit `apps/api/wrangler.toml`: set `name`, and set
`database_name` to whatever you want the database called.

Create the database and paste the id it prints back into `wrangler.toml`:

```bash
cd apps/api
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

`.github/workflows/deploy.yml` builds and deploys on every push to `main`. It
needs a `CLOUDFLARE_API_TOKEN` repo secret (Settings → Secrets and variables →
Actions) with **Workers Scripts: Edit** and **D1: Edit**. A token missing D1
fails with a generic `Authentication error [code: 10000]`.

The workflow does not run migrations and does not run tests. Migrations are
yours to apply by hand, in the same window as the push that needs them. Tests
run in the `pre-push` hook, which `pnpm install` wires up.

## Receipt scanning

`POST /api/groups/:id/scan` proxies to the Gemini API using a Worker secret:

```bash
pnpm --filter @bida/api exec wrangler secret put GEMINI_API_KEY
```

Set it once, not per deploy. Without it the scan button fails and the rest of
the app is unaffected.

**Don't put this on a public instance as it stands.** The endpoint authenticates
against a group token, but any unseen group id registers itself under whatever
bearer arrives — that is how a quick split mints its credential — so two
unauthenticated requests reach the proxy and spend your key, and the client
supplies the whole request body, so it will relay any prompt, not just receipts.
Nothing is rate-limited. Fine for a handful of people you know; not fine on an
address you advertise. See `todo.md` for the shape of the fix.

The same door writes ops into D1 with no cap, which matters more on a public
instance than on the numbers in [docs/hosting.md](docs/hosting.md#how-full-can-it-get).

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

- Nothing is ever deleted from the op log, and there is no admin panel and no
  way to delete a group. [docs/hosting.md](docs/hosting.md) does the arithmetic
  on when 500 MB runs out.
- D1's only infrastructure-level undo is Time Travel: 7 days on the free plan.
- The server cannot read a group's data — it is encrypted on the phone
  ([ADR-0036](docs/decisions/0036-the-server-cannot-read-a-group.md)). That also
  means you cannot recover anything for a user who loses their link, and neither
  can they.
