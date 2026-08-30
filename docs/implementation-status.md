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

**Live:** <https://hajsik.hajsik-api.workers.dev> — static export *and* sync API,
backed by the `hajsik` D1 database. Verified against production: idempotent
push, pull, wrong-secret rejection, and a real group synced between devices.

Since: **a name is enough, and history is read rather than rewound.** The square
holding a person's first letter is gone from every screen that names anyone —
it repeated the word beside it — surviving only for a group in the list of
groups and as the who-had-what grid's column headings
([ADR-0032](decisions/0032-a-name-is-enough.md)). Restore-to-version is gone with
it: `/g/restore`, `buildRestorePatch` and `foldEntityAt` are deleted, undoing
something is editing it ([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)),
and the `restore` op kind still folds only because production groups hold some.
Three things the log said wrongly are fixed at their source: `editExpense` no
longer writes a `kind` that didn't change (a new entry reads *created*, not
*turned back into an expense*), a membership revision is named after the member
it is *about* (adding two people isn't three people joining), and a settle-up
card opens a pre-filled transfer again — the draft is keyed by what seeded it.

Before it: a group holds three kinds of entry, not one. **Expenses, incomes and
transfers**, all editable, on one form with a segmented control and one detail
screen that looks its id up in both tables
([ADR-0028](decisions/0028-three-kinds-of-entry.md)). An income is a single
field on an expense — `kind: 'income'`, absent on everything else — and the
sign is applied once, in `computeBalances`; a transfer is the `Settlement` we
already had, called what it is everywhere a person can read. `/g/settle` is
deleted (settling up links into the form with the transfer pre-filled) and
`/g/expense*` is now `/g/entry*`. A transfer's two sides carry their label
above the face, and **no field anywhere opens a browser picker**: the payer, both
currency fields and the sides are all `ChoiceDialog`, with the other side listed
as a swap and "Other…" handing over to the three-letter prompt. `<input
type="date">` is the last native control
([ADR-0029](decisions/0029-a-picker-is-a-dialog.md),
[ADR-0030](decisions/0030-every-picker-is-a-dialog.md)).

Also: the browser's own gestures answer to the app. A long press does nothing
(`components/no-long-press.tsx` — CSS only ever silenced iOS's callout), a pinch
doesn't zoom (viewport meta, `touch-action` and `components/no-pinch-zoom.tsx`
together, since no one of them covers every browser), and an up-link unwinds
history to the parent rather than pushing (`lib/nav.ts`,
[ADR-0027](decisions/0027-back-goes-up-the-hierarchy.md)).

Before it: the two failures that could quietly cost a trip its ledger now say so.
Sync records how every attempt went, and `/g` warns after two consecutive
failures — or at once, in its own words, when the server refuses this device's
secret, which retrying can never fix; `navigator.onLine` had been the only
signal, and it reports a link rather than an answering server
([sync.md](sync.md#the-sync-engine)). And `lib/persist.ts` asks the browser not
to evict IndexedDB: Safari drops it after seven days uninstalled, taking
unpushed ops and the group secrets with no account to log back in with
([architecture.md](architecture.md#gotchas)).

Before it: the groups list is the front door — wordmark, app name and the
light/dark button alone on the bar; `/settings` is deleted, the personal lens
unconditional, and outside a group there is no bottom bar
([ADR-0026](decisions/0026-the-groups-list-is-the-settings-screen.md)). Every
question the app asks is a `<dialog>` it draws rather than the browser's, so
`/g/leave` is deleted and a failed write says so where it was attempted
([ADR-0025](decisions/0025-our-own-dialogs.md)). And it is usable offline: the
service worker precaches the whole export, cache-first
([frontend.md](frontend.md#pwa),
[ADR-0024](decisions/0024-precache-the-whole-export-cache-first.md); verify with
`node scripts/offline-check.mjs`), and nothing it does waits in silence
([design-system.md](design-system.md#nothing-waits-in-silence)).

Design signed off 2026-08-27 (*"i approve of your design, go wild"*), re-cut
2026-08-29 to one monospace face, near-neutral grounds, and colour spent only on
`--credit` and `--debit` ([ADR-0023](decisions/0023-monospace-monochrome.md)).

## The next action

**Phase 4 — receipt scanning is done; the rest of Phase 4 is next.**
Photograph a receipt and it fills the expense form:
[receipt-scanning.md](receipt-scanning.md),
[ADR-0016](decisions/0016-receipt-scan-ux-and-item-assignment.md),
[ADR-0017](decisions/0017-receipt-items-persist-on-the-expense.md),
[ADR-0018](decisions/0018-receipt-as-a-fourth-split-tab.md),
[ADR-0019](decisions/0019-receipt-mode-owns-the-total.md),
[ADR-0020](decisions/0020-receipt-total-and-split-are-derived-not-cached.md),
[ADR-0021](decisions/0021-leaving-receipt-mode-hands-the-total-back.md),
[ADR-0022](decisions/0022-unfolding-a-receipt-line-into-portions.md).
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
design/mockups/  approved HTML/CSS, source of truth for visual design
```

Root scripts: `test`, `typecheck`, `build`, `check`, `shots`.
`tsconfig.base.json`: ES2022, strict, `noUncheckedIndexedAccess`,
`verbatimModuleSyntax`.

### `apps/web`

Every screen is built. Routes and their jobs are listed in
[frontend.md](frontend.md#routing) — that table is the current one; don't
duplicate it here. Data layer: Dexie schema, materialised stores, and
`lib/db/commands.ts` (one function per user intent). Sync engine in
`lib/db/sync.ts`. What the three kinds of entry are *called* lives once, in
`lib/entry-kind.ts`. 93 smoke tests.

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
- **HLCs are totally ordered by string comparison**; a peer more than an hour
  ahead is rejected, not absorbed.
- **Payer and consumer sides both sum to `baseAmountMinor` exactly**, including
  a payer who isn't a participant.
- **An income is exactly the negation of the same entry as an expense**, member
  for member, and is counted apart from spend rather than netted into it.

### The pinned fixture

`fixtures.test-helper.ts` builds a four-person Marrakech trip. Its numbers are
the ones printed in `design/mockups/index.html`, deliberately — if
`balance.test.ts` fails, the mockup is out of date, not the code.

```
net: ada −244,56  marie +461,65  sam −111,47  theo −105,62   (EUR minor ×100)
total spend 963,14 · transfers ada→marie 244,56 · sam→marie 111,47 · theo→marie 105,62
```

## Decisions settled in code, not in an ADR

1. **Seeded remainder tiebreak.** `resolveSplit` takes `tiebreakSeed` (callers
   pass the expense id) so the leftover cent rotates instead of always landing
   on the alphabetically-first member. Never surfaced in the UI —
   [standing-instructions](standing-instructions.md#dont-make-a-feature-of-the-odd-cent).
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
