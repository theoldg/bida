# Implementation status

*For: an agent starting a cold session, or restarting after one died.*

**Read this before [roadmap.md](roadmap.md).** The roadmap says what the plan is.
This file says how far it actually got, what has been proven, and what the very
next action is. Update it in the same commit as the code it describes — a stale
status file is worse than none.

---

## Where we are

**Phase 0 and Phase 1 are done. Phase 2 is done except the screenshot harness.
Phase 3's code is done — D1 schema, sync API, sync engine, conflict
surfacing — but not yet deployed: the D1 database hasn't been created on
Cloudflare and the Worker hasn't been redeployed with it.**

The design is signed off (2026-08-27, *"i approve of your design, go wild"*).
Both `apps/web` and `apps/api` now exist.

| Phase | State |
|---|---|
| 0 — Groundwork | ✅ done |
| 1 — Domain core | ✅ done, 88 tests passing |
| 2 — Local-first app, no server | 🟡 done except the screenshot harness |
| 3 — Server and sync | 🟡 code complete; D1 not yet provisioned/deployed ← **you are here** |
| 4 — Receipts | ⬜ not started |
| 5 — History surfaces | ⬜ not started |
| 6 — Polish | ⬜ not started |

**Live URL:** <https://hajsik.hajsik-api.workers.dev> — as of this commit still
serving the *previous* deploy (static export only, no sync). The next deploy
needs a pasted `CLOUDFLARE_API_TOKEN` to create the D1 database and redeploy —
see [hosting.md](hosting.md#deploying) and
[standing-instructions.md](standing-instructions.md#the-owner-pastes-the-cloudflare-token-each-session).

## What exists on disk

```
pnpm-workspace.yaml      apps/* and packages/*
package.json             root scripts: test, typecheck, build, check
tsconfig.base.json       ES2022, strict, noUncheckedIndexedAccess, verbatimModuleSyntax
packages/core/           @hajsik/core — pure domain logic, no I/O, no framework
apps/web/                @hajsik/web — Next.js static export, the whole UI
apps/api/                @hajsik/api — Cloudflare Worker; serves apps/web/out today,
                         will host the Hono sync API in Phase 3
design/mockups/          approved HTML/CSS. Source of truth for visual design
docs/                    you are here
```

### `apps/web` — what's built

Screens (each its own static route — see
[ADR-0007](decisions/0007-per-screen-routes-not-drawers.md)):

| Screen | File | State |
|---|---|---|
| Groups list | `app/page.tsx` | ✅ |
| Create group | `app/new/page.tsx` | ✅ |
| Group view (expenses/balances/settle tabs) | `app/g/page.tsx` | ✅ |
| Expense detail | `app/g/expense/page.tsx` | ✅ |
| Add/edit expense | `app/g/expense/edit/page.tsx` | ✅ |
| Split editor | `app/g/split/page.tsx` | ✅ |
| Version history | `app/g/history/page.tsx` | ✅ |
| Members (claim identity, rename, remove, add, invite link) | `app/g/members/page.tsx` | ✅ |
| Record a settlement | `app/g/settle/page.tsx` | ✅ |
| Join a shared link | `app/join/page.tsx` | ✅ *(see caveat below)* |
| Settings (theme, personal mode) | `app/settings/page.tsx` | ✅ |

Data layer: Dexie schema, materialised stores, and `lib/db/commands.ts`
(one function per user intent) are built — see [sync.md](sync.md) for the
shape. Personal mode (`usePersonalMode`, `Screen`'s `.personal` class,
`ExpensesTab`'s highlight/fade) and multi-currency entry with a manually
entered rate (`app/g/expense/edit/page.tsx`'s currency picker + rate input)
are both confirmed wired into the built screens, not just `packages/core`.

**`/join` now pulls for real.** It saves the invite secret, calls the sync
engine once immediately, then checks whether the group landed locally. Second-
device sharing works once both the sync API is deployed (see **Where we are**
above) and the creating device has synced at least once — see
[sync.md](sync.md#gotchas).

**Not built:** the screenshot/UI-inspection harness (see
[testing.md](testing.md)). That is now the only unchecked box left in Phase 2.

### `apps/api` — what's built

A Hono app serving three kinds of route: the sync API (`POST`/`GET
/api/groups/:id/ops`, `apps/api/src/index.ts`), `/api/health`, and everything
else passed through to the `ASSETS` binding (the static export). D1 schema in
`apps/api/migrations/0001_init.sql`. No R2, no attachment routes yet — that's
Phase 4. See [hosting.md](hosting.md#deploying) for the `wrangler.toml` shape,
the one-time D1 setup, and how to deploy.

### `packages/core` module map

| Module | Exports the rest of the app will reach for |
|---|---|
| `money.ts` | `parseMinor`, `formatMinor`, `minorToDecimalString`, `convertMinor`, `sumMinor`, `divRound`, `exponentOf`, `isValidRate` |
| `hlc.ts` | `createHlcState`, `hlcSend`, `hlcReceive`, `compareHlc`, `formatHlc`, `parseHlc`, `maxHlc` |
| `ops.ts` | `Op`, `validateOp`, `isSynced`, `IMMUTABLE_FIELDS`, `OpValidationError` |
| `fold.ts` | `foldOps`, `foldForward`, `sortOps`, `entityOps`, `foldEntityAt` |
| `split.ts` | `resolveSplit`, `validateSplit`, `shareOf`, `convertSplitMode`, `splitParticipants` |
| `balance.ts` | `computeBalances`, `netFor`, `assertBalanced` |
| `settle.ts` | `settleUp`, `transfersFor`, `applyTransfers` |
| `history.ts` | `entityHistory`, `activityFeed`, `buildRestorePatch` (`revisionsForEntity` is module-private) |
| `types.ts` | `Group`, `Member`, `Expense`, `Settlement`, `Attachment`, `SplitSpec`, `GroupState`, `emptyGroupState`, `alive` |
| `ids.ts` | `newId`, `newNodeId`, `newGroupSecret`, `newColorSeed` |

Run it:

```bash
pnpm install
pnpm --filter @hajsik/core test          # 88 tests, ~1s
pnpm --filter @hajsik/core typecheck
```

## What has actually been proven

Not "written" — *tested*, and the tests pass:

- **Money never floats.** BigInt internals, half-away-from-zero rounding, ISO
  4217 exponent overrides (JPY 0, TND 3, CLF 4).
- **Every split sums to the total exactly**, across all four modes, checked
  against 500 randomised cases as well as the hand-picked edges.
- **Splits are identical on every device.** Remainders go by largest fractional
  part, ties broken by a seeded hash — pure, no clock, no iteration order.
- **Any permutation of the same ops folds to the same state**, and folding a
  late-arriving op is detected (`foldForward` returns `null` → caller rebuilds).
- **`settleUp` clears every balance to zero**, across 300 randomised groups.
- **HLCs are totally ordered by plain string comparison**, and a peer whose
  clock is more than an hour ahead is rejected rather than absorbed.

### The pinned fixture

`fixtures.test-helper.ts` builds a four-person Marrakech trip. Its numbers are
also the numbers printed in `design/mockups/index.html`, deliberately — if
`balance.test.ts` fails, the mockup is out of date, not the code.

```
net:    ada −244,56   marie +461,65   sam −111,47   theo −105,62   (EUR minor units ×100)
total spend: 963,14
transfers:  ada→marie 244,56 · sam→marie 111,47 · theo→marie 105,62
```

## Decisions made while implementing

Beyond the six ADRs, two things were settled in code:

1. **Seeded remainder tiebreak.** Ties used to break by ascending member id,
   which meant the alphabetically-first member absorbed the leftover cent of
   every split in the group. `resolveSplit` now takes `tiebreakSeed` and
   `computeBalances` passes the expense id, so the burden rotates while staying
   deterministic. **It is never surfaced in the UI** — see
   [standing-instructions](standing-instructions.md#dont-make-a-feature-of-the-odd-cent).
2. **`packages/core` excludes the DOM lib**, so `ids.ts` declares its own
   minimal `CryptoLike` interface rather than depending on `Crypto`.

## The next action, concretely

1. **Deploy Phase 3.** All the code is written and tested but nothing is live
   yet. Needs a pasted `CLOUDFLARE_API_TOKEN` from the owner, then:
   ```bash
   cd apps/api
   npx wrangler d1 create hajsik      # paste the printed database_id into wrangler.toml
   pnpm db:migrate                    # applies migrations/0001_init.sql
   pnpm --filter @hajsik/web build
   pnpm --filter @hajsik/api deploy
   ```
   After that, do a real two-tab or two-device check: create a group in one
   tab, copy its invite link, open it in another (or in a private window) and
   confirm the group and its members actually appear — this has not been
   exercised against a live server yet, only against a mocked `fetch` in
   `apps/web/lib/db/sync.test.ts`.
2. The screenshot/UI-inspection harness (`pnpm shots`) — see
   [testing.md](testing.md). Not started; build it against the Playwright
   Chromium already available in the agent environment, driving the real
   static export (`apps/web/out`), one PNG per route.

See [roadmap.md](roadmap.md#phase-3--the-server-and-sync-still-the-mvp) for
the full Phase 3 checklist — everything on it is done except the deploy step
above and the custom domain, which needs the owner's own domain in Cloudflare
DNS.

## Gotchas paid for already

- `pnpm` skips esbuild's postinstall by default, which breaks vitest. The root
  `package.json` carries `"pnpm": { "onlyBuiltDependencies": ["esbuild"] }`.
- Don't use `|` as a `perl -pe s|||` delimiter on a file containing markdown
  tables. It ate `docs/README.md` once.
- `next build` (not `next dev`) fails to resolve `packages/core`'s `.js`-suffix
  sibling imports unless `apps/web/next.config.mjs` sets
  `config.resolve.extensionAlias`. Full explanation in
  [hosting.md](hosting.md#gotchas). Run a real production build before
  assuming anything deploys — `next dev` won't catch this.
- `apps/api/wrangler.toml`'s `database_id` is still the literal placeholder
  `REPLACE_WITH_D1_DATABASE_ID` as of this commit. `wrangler deploy --dry-run`
  succeeds anyway (it doesn't validate the id against the account), so a dry
  run passing is not proof the real deploy will work — see the next action
  above.
