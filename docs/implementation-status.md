# Implementation status

*For: an agent starting a cold session. What actually exists, and what's next.
Update it in the same commit as the code it describes.*

## Where it stands

The MVP — Phases 0–3 — is complete, deployed and syncing in production, and the
app has since grown three kinds of entry, a rate registry and read-only history.
Phase 4, receipts, is next. The phase-by-phase ticks are in
[roadmap.md](roadmap.md); this file doesn't repeat them.

**Live:** <https://hajsik.hajsik-api.workers.dev> — static export *and* sync API,
backed by the `hajsik` D1 database. Verified against production: idempotent
push, pull, wrong-secret rejection, and a real group synced between devices.

**Known defects live in [bugs.md](../bugs.md)** — a triaged queue, not a record,
and the first place to look before believing a screen works. Two items open:
two members added under one name can't be merged, and a departed member's
balance can't be cleared.

## What it does today

Every screen is built; routes and their jobs are in
[frontend.md](frontend.md#routing) — that table is the current one, don't
duplicate it. A group holds three kinds of entry — expense, income, transfer —
all editable, on one form with a segmented control and one detail screen
([ADR-0010](decisions/0010-what-an-entry-is.md)).

**What a foreign amount is worth is the group's, not the entry's.** `/g/rates`
holds one rate per currency, synced as an op, and `atCurrentRates` values the
whole ledger in one pass where state is read — so correcting a rate moves every
entry already written in that currency. The dialog fetches a suggestion through
the Worker, takes the number in either direction, and never writes without a
Save ([ADR-0005](decisions/0005-money-and-currency.md)).

**An edit writes only what the edit changed.** The form posts every field; the
command layer diffs them against the entity and appends a patch of what actually
moved, so two phones editing different fields of one expense offline both keep
their change, and a save that touched nothing appends nothing
([sync.md](sync.md#the-operation)). Removing a rate is refused on the same terms
as removing a person — only while nothing is written in that currency
([data-model.md](data-model.md)).

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

The rest is the ADRs holding: every word a person reads lives once in
`apps/web/lib/copy.ts`, fenced by `pnpm check`
([ADR-0033](decisions/0033-every-word-in-one-file.md)); nothing the browser
draws is used, down to the row menus and every picker
([ADR-0008](decisions/0008-hand-rolled-interface.md)); a screen is a route and
an up-link unwinds to the parent the device's back button agrees with
([ADR-0007](decisions/0007-a-screen-is-a-route.md)); history is read, not
rewound — `/g/restore` and `buildRestorePatch` are gone, and the `restore` op
kind still folds only because production groups hold some
([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)); and the
look is one monospace face with colour only on money
([ADR-0023](decisions/0023-monospace-monochrome.md)).

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

## What has been proven — tested, not just written

249 tests in `packages/core`, 141 UI smoke tests in `apps/web`. What the core
suite guarantees, beyond that it runs:

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
- **A rate inverts and comes back.** 12 stored significant digits against 6
  shown, so a rate typed as its own inverse round-trips; repricing at the rate
  an entry was saved with is a no-op, and a rate that can't convert leaves the
  entry as it was instead of throwing on a render.

### The pinned fixture

`fixtures.test-helper.ts` builds a four-person Marrakech trip. The numbers
below are the ones it asserts — if `balance.test.ts` fails, this doc is out of
date, not the code.

```
net: ada −244,56  marie +461,65  sam −111,47  theo −105,62   (EUR minor ×100)
total spend 963,14 · transfers ada→marie 244,56 · sam→marie 111,47 · theo→marie 105,62
```
