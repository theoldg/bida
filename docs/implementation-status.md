# Implementation status

*For: an agent starting a cold session, or restarting after one died.*

**Read this before [roadmap.md](roadmap.md).** The roadmap says what the plan is.
This file says how far it actually got, what has been proven, and what the very
next action is. Update it in the same commit as the code it describes — a stale
status file is worse than none.

---

## Where we are

**Phase 0 and Phase 1 are done. Phase 2 is substantially built. Phase 3 has a
minimal deploy path but no server logic yet.**

The design is signed off (2026-08-27, *"i approve of your design, go wild"*).
Both `apps/web` and `apps/api` now exist.

| Phase | State |
|---|---|
| 0 — Groundwork | ✅ done |
| 1 — Domain core | ✅ done, 88 tests passing |
| 2 — Local-first app, no server | 🟡 most screens built ← **you are here** |
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
| Members (claim identity, rename, remove, add) | `app/g/members/page.tsx` | ✅ |
| Record a settlement | `app/g/settle/page.tsx` | ✅ |
| Join a shared link | — | ⬜ not built |
| Settings (which member is "you", personal mode default) | — | ⬜ not built |

Data layer: Dexie schema, materialised stores, and `lib/db/commands.ts`
(one function per user intent) are built — see [sync.md](sync.md) for the
shape. Personal mode and multi-currency entry: check current code before
assuming either is done, this file only tracks screens.

**Not built:** the `/join` landing screen (so a shared link currently has
nowhere to land a second device), the Settings screen, the PWA service worker,
and the screenshot/UI-inspection harness (see [testing.md](testing.md)). PWA
icons **are** built — see [frontend.md](frontend.md#pwa).

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

What's left before Phase 2 is genuinely done and usable end-to-end on one
device:

1. The `/join` screen — landing for a shared link, claims a member slot. Right
   now there's no page to receive `#<groupId>.<secret>` and get a second
   device into a group at all.
2. The Settings screen — which member is "you" on this device, personal-mode
   default.
3. Confirm personal mode and multi-currency entry are actually wired into the
   built screens, not just in `packages/core`.
4. The screenshot/UI-inspection harness (`pnpm shots`) — see
   [testing.md](testing.md).
5. The service worker (app-shell precache only). PWA manifest + icons are
   already in place — see [frontend.md](frontend.md#pwa).

**Do not start real Phase 3 work (D1, sync, auth) until `/join` exists and the
app is genuinely usable by two people on two devices, even if they have to
swap a link by hand.** The current deploy (static assets only, see
[hosting.md](hosting.md#deploying)) is a Phase 3 head start, not Phase 3 itself.

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
