# Implementation status

*For: an agent starting a cold session, or restarting after one died.*

**Read this before [roadmap.md](roadmap.md).** The roadmap says what the plan is.
This file says how far it actually got, what has been proven, and what the very
next action is. Update it in the same commit as the code it describes — a stale
status file is worse than none.

---

## Where we are

**Phases 0-3 are done — the MVP is complete and deployed. Phase 7 (the owner's
punch list) is done too; all eight items are on `main`.** Since then, three
follow-ups from the owner (2026-08-28): the bottom bar is pinned again on
screens taller than the viewport, identity claims are now ops on the shared
log — [ADR-0011](decisions/0011-identity-changes-are-public.md) — and a
trimming pass took the UI down to three tabs, one member list and much less
prose — [ADR-0012](decisions/0012-balances-and-settling-are-one-screen.md).

The design is signed off (2026-08-27, *"i approve of your design, go wild"*).
`apps/web` and `apps/api` both exist and are both live.

| Phase | State |
|---|---|
| 0 — Groundwork | ✅ done |
| 1 — Domain core | ✅ done, 110 tests passing |
| 2 — Local-first app, no server | ✅ done — `pnpm shots` closed the last box |
| 3 — Server and sync | ✅ done and deployed — **MVP complete** |
| 4 — Receipts | ⬜ not started ← next up |
| 5 — History surfaces | ⬜ not started |
| 6 — Polish | ⬜ not started |
| 7 — Owner's punch list | ✅ all eight done — [punchlist.md](punchlist.md) |

**Live URL:** <https://hajsik.hajsik-api.workers.dev> — serving the static
export *and* the sync API, backed by the `hajsik` D1 database (created and
migrated 2026-08-27). Verified live: `POST`/`GET /api/groups/:id/ops`
round-tripped correctly against production (idempotent push, pull, wrong-secret
rejection), and a real group with members and an expense was observed synced
through it within minutes of deploy — i.e. this isn't just passing tests, it
has carried a real write.

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
| Group view (expenses / balances-and-settling tabs) | `app/g/page.tsx` | ✅ |
| Expense detail | `app/g/expense/page.tsx` | ✅ |
| Add/edit expense (split included) | `app/g/expense/edit/page.tsx` | ✅ |
| Split editor | `components/split-editor.tsx` — inline on the expense form | ✅ |
| Version history | `app/g/history/page.tsx` | ✅ |
| People (claim identity, rename, remove, add, copy invite link) | `app/g/members/page.tsx` | ✅ |
| Record a settlement | `app/g/settle/page.tsx` | ✅ |
| Join a shared link | `app/join/page.tsx` | ✅ *(see caveat below)* |
| Pick who you are, after joining | `app/g/claim/page.tsx` | ✅ |
| Restore confirmation | `app/g/restore/page.tsx` | ✅ |
| Settings (personal mode, theme) — from the group list | `app/settings/page.tsx` | ✅ |

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

**Phase 7 is in here too.** One bottom bar (the top tab strip is gone),
`/g/options` with identity, personal mode and theme, an identity claim log,
nothing selectable, a real `<input inputMode="decimal">` amount field in
place of the keypad, generic placeholders, and co-sponsored expenses via
`/g/payers`. Item by item: [punchlist.md](punchlist.md).

**Two owner follow-ups landed on 2026-08-28:**

- *"the bottom bar is only visible when i scroll down"* — the shell was
  `min-height: 100dvh`, so on any screen taller than the viewport it grew with
  its content, the document scrolled instead of `.scroll`, and the bar sat at
  the foot of a long page. It is `height: 100dvh; overflow: hidden` now, with
  `min-height: 0` on the scrolling child and `overflow: hidden` on `html, body`.
  Gotcha written up in [frontend.md](frontend.md#gotchas).
- *"the edits should record who did it, and that's why i wanted to track the
  identity changes, also on the public log"* — claiming or switching identity is
  an `identity` op keyed by the device's HLC node id. It folds into
  `GroupState.identities`, renders on `/g/history` beside every other change,
  and the device-local `identityLog` table is dropped. (`/g/options` rendered
  this phone's timeline back out of the log for a day; ADR-0012 removed that
  view — the feed already tells the story.) Dexie is at v3, and
  `publishExistingClaims` publishes, once on next launch, the claim a device
  made before this shipped.
  [ADR-0011](decisions/0011-identity-changes-are-public.md) supersedes ADR-0009.
- *"in the edit history, drop both kinds of 'this change was later overwritten
  by XYZ', they're visually noisy. add links to relevant expenses"* — the
  overwrite notes are gone from `/g/history` (the `supersededByOpId` data
  behind them is untouched and still tested — [sync.md](sync.md#conflicts)),
  and every expense revision in the whole-group feed now carries a link to the
  expense it was about, or to that expense's own history if it has since been
  deleted.
- *"when joining for the first time, after selecting my identity I'm in the
  people menu … it's counterintuitive to hit back"* — `/join` now hands over to
  **`/g/claim`**, the same list of names with one job: pick, then a primary
  button into the group. `/g/members` stays a management screen.
- *"make the 'restore this version' way more discreet … make the expense link
  bigger / more inviting"* — restore is a rewind icon at the right edge of a
  revision leading to **`/g/restore`**, a confirmation screen naming the version
  and the fields coming back (it replaces a `confirm()`); it is offered only
  where something would actually change. The expense link is a pressable pill.
  The revision sentence and field formatters moved to `lib/history-copy.ts`,
  shared by both screens.
- *"make the copy link button just copy the link … also cut some fat from the
  ui"* — both invite buttons copy to the clipboard and say so in place
  (`useInviteLink`); `navigator.share` is gone. The bottom bar is three items,
  with settling on the balances tab; identity is claimed on `/g/members` and
  nowhere else; this phone's identity timeline is gone from `/g/options`
  (the ops are still on `/g/history`); and the subtitles and explanatory
  paragraphs that restated what the screen already showed are deleted. Then
  `/g/options` itself came down to a "Copy invite link" button and the two
  device switches: People and History are icons in `/g`'s top bar, and a group
  can no longer be renamed (`renameGroup` stays in `commands.ts` — the ops
  still have to fold — but nothing calls it).
  [ADR-0012](decisions/0012-balances-and-settling-are-one-screen.md), and the
  standing bar for new copy is in
  [standing-instructions.md](standing-instructions.md).

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
| `fold.ts` | `foldOps`, `foldForward`, `sortOps`, `entityOps`, `foldEntityAt` — buckets include `identities`, keyed by device node id |
| `split.ts` | `resolveSplit`, `validateSplit`, `shareOf`, `convertSplitMode`, `splitParticipants` |
| `balance.ts` | `computeBalances`, `netFor`, `assertBalanced` |
| `settle.ts` | `settleUp`, `transfersFor`, `applyTransfers` |
| `history.ts` | `entityHistory`, `activityFeed`, `buildRestorePatch` (`revisionsForEntity` is module-private) |
| `types.ts` | `Group`, `Member`, `Expense`, `Settlement`, `Attachment`, `SplitSpec`, `GroupState`, `emptyGroupState`, `alive` |
| `ids.ts` | `newId`, `newNodeId`, `newGroupSecret`, `newColorSeed` |

Run it:

```bash
pnpm install
pnpm --filter @hajsik/core test          # 110 tests, ~1s
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

**The MVP is done and live.** What's left is Phase 4 (receipts) and the two
loose ends below — neither blocks real use of the app.

1. **Done, 2026-08-27:** the screenshot harness. `pnpm shots` builds the app,
   serves the real static export, seeds a group through the UI and writes 28
   PNGs (14 screens × 2 themes) into `shots/`. See
   [testing.md](testing.md#pnpm-shots--photograph-every-screen) — including
   the four ways it bit while being written.
2. **Done, 2026-08-27:** ran the real cross-device `/join` check (two browser
   profiles, a local `wrangler dev` + D1) that was flagged above as not yet
   done — and it turned up a genuine bug, not just an unverified path. A
   brand-new device (no local cache, unlike a returning device) whose first
   `syncGroup()` call failed landed on a dead-end screen with no retry —
   "nothing responds" from the user's side, only ever hit by someone who'd
   never used the app before. Fixed in `apps/web/app/join/page.tsx` by making
   the screen watch the local DB with a live query instead of a one-shot
   check; see [sync.md's gotchas](sync.md#gotchas) for the full story.

See [roadmap.md](roadmap.md#phase-3--the-server-and-sync-deployed-2026-08-27--mvp-complete)
for the full Phase 3 checklist. Phase 4 (receipts) is next —
[product.md](product.md) and [roadmap.md](roadmap.md#phase-4--receipts) have
the scope.

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
- `wrangler deploy --dry-run` succeeds even with a bogus `database_id` in
  `apps/api/wrangler.toml` — it doesn't validate the id against the account.
  A clean dry run is not proof the real deploy will work; only a real
  `wrangler deploy` (or `wrangler d1 list`) catches a wrong id.
- A Cloudflare API token scoped only for Workers (e.g. a token from an earlier
  session, before D1 existed in this repo) fails D1 calls with a generic
  `Authentication error [code: 10000]`, not a clear permissions message.
  `wrangler whoami` succeeding is not proof the token can create/read D1 —
  needs the "D1 - Edit" permission specifically.
