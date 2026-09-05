# Roadmap

*For: an agent looking for the next job. Tick boxes as you go.*

**The MVP is Phases 0–3 inclusive** — an app that only works on the phone it was
typed into is a notebook. Phases 4–6 were the finish, not the product.

**Every phase below is closed** (2026-09-05). What the owner still wants doing
is in [bugs.md](../bugs.md); what was cut rather than built is at the bottom of
this file, seams intact.

## Phase 0 — Groundwork ✅
Hosting decided, MVP scope agreed, the visual direction signed off
(2026-08-27), pnpm workspace with `packages/core`, `apps/web`, `apps/api`.

## Phase 1 — Domain core ✅ *(249 tests)*
`money`, `hlc`, `ops`, `fold`, `split`, `payers`, `balance`, `settle`, `rates`, plus
property tests that any permutation of ops folds identically.

## Phase 2 — Local-first app ✅
Dexie schema and rebuild-from-ops, `lib/db/commands/`, every screen, `/join`,
the personal lens, multi-currency entry (the registry came in Phase 10), PWA
manifest + shell service worker, and `pnpm shots`.

## Phase 3 — Server and sync ✅ *(deployed 2026-08-27 — MVP complete)*
One Worker serving the export and the API, D1 schema + migrations, the two op
endpoints, link-only auth (`sha256` bearer check), the sync engine, and conflict
surfacing in history. Verified live, and cross-device `/join` verified for real
with two browser contexts — which turned up a genuine first-run bug, now fixed
([sync.md's gotchas](sync.md#gotchas)).

## Phase 4 — Receipts ✅ *(2026-09-05)*
**Scan a receipt into the expense form** — [receipt-scanning.md](receipt-scanning.md),
[ADR-0016](decisions/0016-receipts.md). It needs no storage: the photo is read
and thrown away. Button, states, privacy line, and a who-had-what screen for
line items — where a "×2" line unfolds into separately assignable portions —
all live.

Storing the photo (multi-image capture, on-device downscale, R2 upload,
gallery) was the other half and is **cut** — scanning is what a receipt was
wanted for. The seam is below.

## Phase 5 — History surfaces ✅
Per-entry revision timeline with field diffs and a group activity feed, read
only ([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md) dropped
restore-to-version). Landed alongside Phase 7; `lib/history-copy.ts` holds the
wording.

## Phase 6 — Finish ✅ *(2026-09-05)*
- [x] Install prompt — `lib/install.ts` + `components/install.tsx`
- [x] The two ways a real trip loses data: storage evicted under a phone
      (`lib/persist.ts`) and sync failing where nothing said so (`useSyncHealth`)
- [x] Empty states — `copy.ts` carries them for the ledger, history, the rate
      registry and a link that opens nothing

CSV export and categories were the rest of it and are **cut**, below. So is the
custom domain, which was only ever the owner pointing DNS at Cloudflare —
`workers.dev` doesn't expire, so it is not project work.

## Phase 8 — Three kinds of entry ✅ *(2026-08-30)*
Expenses, incomes and transfers, all editable, on one form and one detail
screen; `/g/settle` and `/g/expense*` are gone
([ADR-0010](decisions/0010-what-an-entry-is.md)). A transfer's sides label
themselves above the face, and every picker on the form — sides, payer, currency
— is our own dialog ([ADR-0008](decisions/0008-hand-rolled-interface.md)).

## Phase 9 — Every word in one file ✅ *(2026-09-03)*
`apps/web/lib/copy.ts` holds every string a person can read, placeholders and
`aria-label`s included, and `pnpm check` fails on a stray literal
([ADR-0033](decisions/0033-every-word-in-one-file.md)) — with the English cut
short on the way through. Alongside it, three things the owner caught: adding
people is the last row of the list rather than a dialog, on `/new` as well as
`/g/members`, refusing a name already on it and scrolling itself into view as
the list grows (`components/name-adder.tsx`); the offline banner shows the moment
the phone is offline, and opening a group asks the server rather than waiting
for the loop; and a scan that can't reach the network says so instead of
blaming the photo. Two more the same day: a failed scan no longer offers "try
again" beside the two scan buttons that already are it, and the device's back
button runs the screen's own back action instead of replaying where you had
been ([ADR-0007](decisions/0007-a-screen-is-a-route.md), `pnpm back`).

## Phase 10 — The group's rate registry ✅ *(2026-09-04)*
What a foreign amount is worth stopped being a number frozen onto each entry
and became one the group holds, per currency, as an op
([ADR-0005](decisions/0005-money-and-currency.md)). `/g/rates` is the icon
between History and People; its dialog fetches a suggestion through the Worker
(`GET /api/rates/:from/:to`), takes the number in whichever direction you think
in, says how many entries a change moves, and opens by itself the first time a
group meets a currency. `core/rates.ts` reprices every entry in one pass where
the app reads its state, so a correction moves the whole ledger at once.

## Phase 7 — The owner's punch list ✅ *(2026-08-27)*
Eight items after a day of living with the deployed MVP: one bottom bar, a
neutral dark theme, in-group options, identity history, nothing selectable, a
real amount input, generic placeholders, and co-sponsored expenses. All landed,
then reshaped by three rounds of follow-ups on 2026-08-28 —
[ADR-0003](decisions/0003-link-only-access.md) and
[ADR-0005](decisions/0005-money-and-currency.md) carry what changed and why.

## Later, deliberately
Restaurant bill splitting · recurring expenses · push notifications ·
real-time collaboration · spend analytics · **storing receipt photos** ·
**CSV export** · **categories**. (Receipt OCR left this list on 2026-08-28 and
shipped as Phase 4; the last three joined it on 2026-09-05.) Seams described in
[product.md](product.md#deliberately-not-in-the-mvp). Don't pre-build them.
