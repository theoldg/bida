# Implementation status

*For: an agent starting a cold session, or restarting after one died.*

**Read this before [roadmap.md](roadmap.md).** The roadmap says what the plan is.
This file says how far it actually got, what has been proven, and what the very
next action is. Update it in the same commit as the code it describes — a stale
status file is worse than none.

---

## Where we are

**Phase 0 and Phase 1 are done. Phase 2 is next and has not been started.**

The design is signed off (2026-08-27, *"i approve of your design, go wild"*), so
nothing is blocked on the owner. There is no `apps/web` and no `apps/api` yet —
they are created when Phase 2 and Phase 3 need them, not up front.

| Phase | State |
|---|---|
| 0 — Groundwork | ✅ done |
| 1 — Domain core | ✅ done, 88 tests passing |
| 2 — Local-first app, no server | ⬜ not started ← **you are here** |
| 3 — Server and sync | ⬜ not started |
| 4 — Receipts | ⬜ not started |
| 5 — History surfaces | ⬜ not started |
| 6 — Polish | ⬜ not started |

## What exists on disk

```
pnpm-workspace.yaml      apps/* and packages/*
package.json             root scripts: test, typecheck, build, check
tsconfig.base.json       ES2022, strict, noUncheckedIndexedAccess, verbatimModuleSyntax
packages/core/           @hajsik/core — pure domain logic, no I/O, no framework
design/mockups/          approved HTML/CSS. Source of truth for visual design
docs/                    you are here
```

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
| `history.ts` | `entityHistory`, `revisionsForEntity`, `activityFeed`, `buildRestorePatch` |
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

Phase 2, in this order — each step is a commit:

1. `apps/web`: Next.js App Router with `output: 'export'`, Tailwind, and the
   mockup's `:root` token block ported into `globals.css` verbatim. Copy in only
   the shadcn primitives actually used (Sheet, Drawer, Tabs, Avatar, Badge,
   Dialog).
2. `lib/db/schema.ts`: Dexie with an `ops` table plus materialised
   `groups`/`expenses` stores, and `rebuild(groupId)` that re-folds from ops.
3. `lib/db/commands.ts`: one exported function per user intent
   (`addExpense`, `editExpense`, `deleteExpense`, `addMember`, `recordSettlement`).
   Each appends an op and re-folds. Nothing else in the app writes to Dexie.
4. Screens, in mockup order: group list → expenses → add expense → split editor
   → expense detail → balances → settle up.
5. Personal mode (the highlighter wash), multi-currency entry with a manual rate.
6. PWA manifest + a shell service worker.

**Do not start Phase 3 until the app is genuinely usable on one device offline.**

## Gotchas paid for already

- `pnpm` skips esbuild's postinstall by default, which breaks vitest. The root
  `package.json` carries `"pnpm": { "onlyBuiltDependencies": ["esbuild"] }`.
- Don't use `|` as a `perl -pe s|||` delimiter on a file containing markdown
  tables. It ate `docs/README.md` once.
