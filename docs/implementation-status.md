# Implementation status

*For: an agent starting a cold session. What actually exists, and what's next.
Update it in the same commit as the code it describes.*

## Phases

| Phase | State |
|---|---|
| 0 — Groundwork | ✅ |
| 1 — Domain core | ✅ 111 tests |
| 2 — Local-first app | ✅ |
| 3 — Server and sync | ✅ deployed — **MVP complete** |
| 4 — Receipts | 🟡 scanning done; multi-image capture, R2 upload, gallery still open |
| 5 — History surfaces | ✅ timeline, feed, restore |
| 6 — Polish | 🟡 install prompt done; CSV export, categories, empty/error states open |
| 7 — Owner's punch list | ✅ all eight, plus follow-up rounds through 2026-08-30 |

**Live:** <https://hajsik.hajsik-api.workers.dev> — static export *and* sync API,
backed by the `hajsik` D1 database. Verified against production: idempotent
push, pull, wrong-secret rejection, and a real group synced between devices.

Since: the groups list is the front door — the tally wordmark and the app's name
alone on the bar, light/dark as one icon button beside them. `/settings` is
deleted, the personal lens is unconditional, and outside a group there is no
bottom bar ([ADR-0026](decisions/0026-the-groups-list-is-the-settings-screen.md)).
On the who-had-what screen, who-was-there scrolls sideways in one line and the
per-person totals stack in a named column.

Before it: the browser's dialogs are gone — adding, renaming and removing a
member, discarding a half-typed expense, an unlisted currency, and leaving a
group all ask in a `<dialog>` this app draws, so `/g/leave` is deleted
([ADR-0025](decisions/0025-our-own-dialogs.md)). The who-had-what grid became the
scrolling band of its own screen so its row of initials freezes over a long bill:
it had been a sticky `<thead>` in a wrapper that only scrolled sideways, which
sticks to nothing ([frontend.md](frontend.md#gotchas)).

Before it: the app is usable offline, and no longer waits on the network
to redraw a screen it already has. The service worker precaches the whole export
under a build-stamped revision and serves it cache-first, RSC payloads included
— they were the miss that turned a tap into a round trip online and a screenful
of `1:"$Sreact.fragment"` off ([frontend.md](frontend.md#pwa); `node
scripts/offline-check.mjs` walks fourteen screens with the network cut, then
installs a deploy over a half-dead network — a precache is all-or-nothing,
because `activate` deletes the previous one). On top
of it, the two states that made the app *feel* slow: every control now darkens
under the thumb the instant it's touched, and a list still coming out of Dexie
draws its own shape rather than a blank
([design-system.md](design-system.md#nothing-waits-in-silence)). The group list
reads five tables whole instead of three per group.

Design signed off 2026-08-27 (*"i approve of your design, go wild"*), then
re-cut 2026-08-29 on the owner's word: one monospace face (JetBrains Mono)
everywhere, near-neutral grounds, and colour spent only on `--credit` and
`--debit` — `--brand` is ink, avatars carry no tint, the highlighter is a grey
wash ([ADR-0023](decisions/0023-monospace-monochrome.md)). Before it
(2026-08-28): a line the receipt counted — `Salade marocaine ×2` —
unfolds on the who-had-what grid into that many separately assignable rows
(two shared one, someone else had the other), and merges back; the portions
sum to the printed line exactly, so the bill's total never moves
([ADR-0022](decisions/0022-unfolding-a-receipt-line-into-portions.md)).

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
A "Receipt" tab
on `/g/expense/edit`'s split editor, alongside Evenly/As parts/As amounts,
holds the camera-capture and library-upload buttons (any expense, saved or
not, sharing one handler) with a spinner-and-label loading state per button,
an error + "try again", and a one-line privacy note; a scan that finds line
items routes to `/g/expense/items`, a who-had-what grid (coloured,
disambiguated initial chips as columns, items as rows, an editable tip that
scales to what each person ordered, and a "×2" line that unfolds into that many
separately assignable portions) that reduces to an ordinary `shares` split —
no new entity, no schema change. The parsed items, tip and grid
assignment persist on the expense itself (plain optional fields), so "Edit
who-had-what" (also on the Receipt tab) can reopen the same grid later, for a
new or already-saved expense, from any device. While Receipt mode has items,
the amount field is computed (items + tip) and disabled, switching away hands
that total back to the field, and the chosen split tab persists across
save/reopen (ADR-0019, ADR-0021). Left for later: multi-image
capture, on-device downscale for photos kept on the expense, R2 upload, and
the gallery/full-screen viewer. Scope in [product.md](product.md).

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
`lib/db/sync.ts`. 67 smoke tests.

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
| `fold.ts` | `foldOps`, `foldForward`, `sortOps`, `entityOps`, `foldEntityAt` |
| `split.ts` | `resolveSplit`, `validateSplit`, `shareOf`, `convertSplitMode`, `splitParticipants` |
| `payers.ts` | `resolvePayers`, `validatePayers`, `payerList`, `isCoSponsored` |
| `balance.ts` | `computeBalances`, `netFor`, `assertBalanced` |
| `settle.ts` | `settleUp`, `transfersFor`, `applyTransfers` |
| `history.ts` | `entityHistory`, `activityFeed`, `buildRestorePatch` |
| `types.ts` | `Group`, `Member`, `Expense`, `Settlement`, `Attachment`, `SplitSpec`, `GroupState`, `emptyGroupState`, `alive` |
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
