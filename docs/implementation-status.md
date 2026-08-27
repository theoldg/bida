# Implementation status

*For: an agent starting a cold session, or restarting after one died.*

**Read this before [roadmap.md](roadmap.md).** The roadmap says what the plan is.
This file says how far it actually got, what has been proven, and what the very
next action is. Update it in the same commit as the code it describes — a stale
status file is worse than none.

---

## Where we are

**Phase 0 and Phase 1 are done. Phase 2 is done except the screenshot harness.
Phase 3 has a minimal deploy path but no server logic yet.**

The design is signed off (2026-08-27, *"i approve of your design, go wild"*).
Both `apps/web` and `apps/api` now exist.

| Phase | State |
|---|---|
| 0 — Groundwork | ✅ done |
| 1 — Domain core | ✅ done, 88 tests passing |
| 2 — Local-first app, no server | 🟡 done except the screenshot harness ← **you are here** |
| 3 — Server and sync | 🟡 static assets deploy live; no D1, no API routes, no sync |
| 4 — Receipts | ⬜ not started |
| 5 — History surfaces | ⬜ not started |
| 6 — Polish | ⬜ not started |

**Live URL:** <https://hajsik.hajsik-api.workers.dev> — static export only,
served by a Cloudflare Worker with no backing data store. See
[hosting.md](hosting.md#deploying).

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

**Caveat on `/join`:** there is still no sync engine (Phase 3), so the screen
parses the link and stores the invite secret, but can only actually land you
in the group if it's already on that device — see
[sync.md's gotcha](sync.md#gotchas). Real second-device sharing is still
blocked on Phase 3.

**Not built:** the screenshot/UI-inspection harness (see
[testing.md](testing.md)). Everything else this file used to list as missing
— `/join`, Settings, the PWA service worker — is now built; PWA icons were
already in place — see [frontend.md](frontend.md#pwa).

### `apps/api` — what's built

A Hono app that passes every request through to the `ASSETS` binding (the
static export), plus one `/api/health` route. No D1, no R2, no sync routes,
no auth — that's all Phase 3. See [hosting.md](hosting.md#deploying) for the
`wrangler.toml` shape and how to deploy.

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

Everything on Phase 2's list is built except one:

1. The screenshot/UI-inspection harness (`pnpm shots`) — see
   [testing.md](testing.md). Not started; build it against the Playwright
   Chromium already available in the agent environment, driving the real
   static export (`apps/web/out`), one PNG per route.

**Phase 2 is otherwise complete, but the app is still not usable by two
people on two devices** — `/join` exists and stores the invite secret, but
with no sync engine a second device has nothing to pull. That's what makes
Phase 3 (D1, the `/api/groups/:id/ops` endpoints, the sync loop) next, not
optional polish — see [roadmap.md](roadmap.md#phase-3--the-server-and-sync-still-the-mvp).
The current deploy (static assets only, see [hosting.md](hosting.md#deploying))
is a Phase 3 head start, not Phase 3 itself.

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
