# Implementation status

*For: an agent starting a cold session. What actually exists, and what's next.
Update it in the same commit as the code it describes.*

## Phases

| Phase | State |
|---|---|
| 0 — Groundwork | ✅ |
| 1 — Domain core | ✅ 124 tests |
| 2 — Local-first app | ✅ |
| 3 — Server and sync | ✅ deployed — **MVP complete** |
| 4 — Receipts | 🟡 scanning done; multi-image capture, R2 upload, gallery still open |
| 5 — History surfaces | ✅ timeline and feed, read only ([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)) |
| 6 — Polish | 🟡 install prompt, storage persistence and sync-failure surfacing done; CSV export, categories, empty states open |
| 7 — Owner's punch list | ✅ all eight, plus follow-up rounds through 2026-08-30 |
| 8 — Three kinds of entry | ✅ expense · income · transfer, all editable |
| 9 — Every word in one file | ✅ `lib/copy.ts`, fenced by `pnpm check` ([ADR-0033](decisions/0033-every-word-in-one-file.md)) |

**Live:** <https://hajsik.hajsik-api.workers.dev> — static export *and* sync API,
backed by the `hajsik` D1 database. Verified against production: idempotent
push, pull, wrong-secret rejection, and a real group synced between devices.

**What it does today.** A group holds three kinds of entry — expense, income,
transfer — all editable, on one form with a segmented control and one detail
screen ([ADR-0010](decisions/0010-what-an-entry-is.md)). Every word a person
reads lives in `apps/web/lib/copy.ts`, fenced by `pnpm check`
([ADR-0033](decisions/0033-every-word-in-one-file.md)). Nothing the browser
draws is used: no `prompt()`, `confirm()` or `<select>`; a long press or a
right click on a row opens the app's own small `RowMenu`
([ADR-0008](decisions/0008-hand-rolled-interface.md)) instead of the
browser's menu. No pinch zoom, and adding a person is the last row of the
list rather than a dialog
— a row that refuses a name already there and follows the list down the screen
([ADR-0008](decisions/0008-hand-rolled-interface.md)). An up-link unwinds to the
parent instead of pushing, and the device's back button runs the screen's own
back action rather than replaying where you had been — one behaviour, arrow and
button ([ADR-0007](decisions/0007-a-screen-is-a-route.md)).
History is read, not rewound — `/g/restore` and `buildRestorePatch` are gone,
and the `restore` op kind still folds only because production groups hold some
([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)). The look is
one monospace face with colour only on money
([ADR-0023](decisions/0023-monospace-monochrome.md)).

**The two failures that could quietly cost a trip its ledger say so.** Sync
records how every attempt went and `/g` warns after two consecutive failures —
or at once, in its own words, when the server refuses this device's secret
([sync.md](sync.md#the-sync-engine)); offline is announced the moment
`navigator.onLine` says so, including as its own scan error. `lib/persist.ts`
asks the browser not to evict IndexedDB, since Safari drops it after seven days
uninstalled and there is no account to log back in with
([architecture.md](architecture.md#gotchas)). The service worker precaches the
whole export cache-first, so the app paints with no signal
([ADR-0004](decisions/0004-static-export-and-offline.md); verify with `node
scripts/offline-check.mjs`).

## The next action

**Phase 4 — receipt scanning is done; the rest of Phase 4 is next.**
Photograph a receipt and it fills the expense form:
[receipt-scanning.md](receipt-scanning.md),
[ADR-0016](decisions/0016-receipts.md).
A "Receipt" tab on the split editor scans a bill (any expense, saved or not)
and routes a scan with line items to `/g/entry/items`, a who-had-what grid
that reduces to an ordinary `shares` split — no new entity, no schema change.
Its items, tip and assignments live on the expense itself, so the grid reopens
later from any device. **Left for later:** multi-image capture, on-device
downscale, R2 upload, and the gallery/viewer. Scope in
[product.md](product.md).

One loose end, not blocking: a custom domain, which needs the owner to point
DNS at Cloudflare. `workers.dev` doesn't expire, so this is cosmetic.

## What's on disk

```
packages/core/   @hajsik/core — pure domain logic, no I/O, no framework
apps/web/        @hajsik/web — Next.js static export, the whole UI
apps/api/        @hajsik/api — Cloudflare Worker: Hono sync API + static assets
```

Root scripts: `session`, `check` (doc links · invariants · typecheck · tests ·
export build — what pre-push runs), `verify`, `entries`, `back`, `offline`,
`shots`, `docs`, `rules`.
`scripts/lib/harness.mjs` holds what the browser checks share — the build, the
static server, a phone-shaped browser, the tally, a seeded group — so they build
themselves and the next one costs a dozen lines ([testing.md](testing.md)).
`tsconfig.base.json`: ES2022, strict, `noUncheckedIndexedAccess`,
`verbatimModuleSyntax`.

### `apps/web`

Every screen is built. Routes and their jobs are listed in
[frontend.md](frontend.md#routing) — that table is the current one; don't
duplicate it here. Data layer: Dexie schema, materialised stores, and
`lib/db/commands.ts` (one function per user intent). Sync engine in
`lib/db/sync.ts`. Every word a person reads lives once, in `lib/copy.ts`;
`lib/entry-kind.ts` is types and arithmetic only. 94 smoke tests.

### `apps/api`

A Hono app with three kinds of route: the sync API (`POST`/`GET
/api/groups/:id/ops`), `/api/health`, and everything else passed to the
`ASSETS` binding. D1 schema in `migrations/0001_init.sql`. No R2 yet — Phase 4.
Deploy steps: [hosting.md](hosting.md#deploying).

### `packages/core` module map

| Module | Exports |
|---|---|
| `money.ts` | `parseMinor`, `formatMinor`, `minorToDecimalString`, `convertMinor`, `sumMinor`, `divRound`, `exponentOf`, `isValidRate` |
| `hlc.ts` | `createHlcState`, `hlcSend`, `hlcReceive`, `compareHlc`, `formatHlc`, `parseHlc`, `maxHlc` |
| `ops.ts` | `Op`, `validateOp`, `isSynced`, `IMMUTABLE_FIELDS`, `OpValidationError` |
| `fold.ts` | `foldOps`, `foldForward`, `sortOps` |
| `split.ts` | `resolveSplit`, `validateSplit`, `shareOf`, `convertSplitMode`, `splitParticipants` |
| `payers.ts` | `resolvePayers`, `validatePayers`, `payerList`, `isCoSponsored` |
| `balance.ts` | `computeBalances`, `netFor`, `assertBalanced` — the one place an income's sign is applied |
| `settle.ts` | `settleUp`, `transfersFor`, `applyTransfers` |
| `history.ts` | `entityHistory`, `activityFeed` |
| `types.ts` | `Group`, `Member`, `Expense`, `ExpenseKind`, `Settlement`, `Attachment`, `SplitSpec`, `GroupState`, `emptyGroupState`, `alive` |
| `ids.ts` | `newId`, `newNodeId`, `newGroupSecret`, `newColorSeed` |
| `scan.ts` | `normalizeScan`, `ScanResult`, `ScanPatch` |

## What has been proven — tested, not just written

- **Money never floats.** BigInt internals, half-away-from-zero rounding, ISO
  4217 exponent overrides (JPY 0, TND 3, CLF 4).
- **Every split sums to the total exactly**, all modes, 500 randomised cases
  plus hand-picked edges, and identically on every device (remainders by
  largest fractional part, ties broken by a seeded hash — no clock, no
  iteration order).
- **Any permutation of the same ops folds to the same state**; a late-arriving
  op is detected (`foldForward` → `null`, caller rebuilds).
- **`settleUp` clears every balance to zero**, 300 randomised groups.
- **HLCs are totally ordered by string comparison**, and a peer's stamp is
  absorbed on receive however far ahead it reads — so a reply to their op
  always sorts after it.
- **Payer and consumer sides both sum to `baseAmountMinor` exactly**, including
  a payer who isn't a participant.
- **An income is exactly the negation of the same entry as an expense**, member
  for member, and is counted apart from spend rather than netted into it.

### The pinned fixture

`fixtures.test-helper.ts` builds a four-person Marrakech trip. The numbers
below are the ones it asserts — if `balance.test.ts` fails, this doc is out of
date, not the code.

```
net: ada −244,56  marie +461,65  sam −111,47  theo −105,62   (EUR minor ×100)
total spend 963,14 · transfers ada→marie 244,56 · sam→marie 111,47 · theo→marie 105,62
```

## Decisions settled in code, not in an ADR

1. **Seeded remainder tiebreak.** `resolveSplit` takes `tiebreakSeed` (callers
   pass the expense id) so the leftover cent rotates instead of always landing
   on the alphabetically-first member. Never surfaced in the UI —
   [standing-instructions](standing-instructions.md#product).
2. **`packages/core` excludes the DOM lib**, so `ids.ts` declares its own
   minimal `CryptoLike` rather than depending on `Crypto`.

## Gotchas

- `pnpm` skips esbuild's postinstall by default, which breaks vitest. The root
  `package.json` carries `"pnpm": { "onlyBuiltDependencies": ["esbuild"] }`.
- Don't use `|` as a `perl -pe s|||` delimiter on a file with markdown tables.
- `wrangler deploy --dry-run` succeeds with a bogus `database_id` — it doesn't
  validate the id against the account. Only a real deploy (or `wrangler d1
  list`) catches a wrong one.
- A Cloudflare token scoped for Workers only fails D1 calls with a generic
  `Authentication error [code: 10000]`. `wrangler whoami` succeeding proves
  nothing; the token needs "D1 - Edit" specifically.
