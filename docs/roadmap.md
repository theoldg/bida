# Roadmap

*For: an agent looking for the next job. Tick boxes as you go.*

**The MVP is Phases 0–3 inclusive** — an app that only works on the phone it was
typed into is a notebook. Phases 4–6 are the finish, not the product.

## Phase 0 — Groundwork ✅
Hosting decided, MVP scope agreed, the visual direction signed off
(2026-08-27), pnpm workspace with `packages/core`, `apps/web`, `apps/api`.

## Phase 1 — Domain core ✅ *(124 tests)*
`money`, `hlc`, `ops`, `fold`, `split`, `payers`, `balance`, `settle`, plus
property tests that any permutation of ops folds identically.

## Phase 2 — Local-first app ✅
Dexie schema and rebuild-from-ops, `lib/db/commands.ts`, every screen, `/join`,
the personal lens, multi-currency entry, PWA manifest + shell service worker,
and `pnpm shots`.

## Phase 3 — Server and sync ✅ *(deployed 2026-08-27 — MVP complete)*
One Worker serving the export and the API, D1 schema + migrations, the two op
endpoints, link-only auth (`sha256` bearer check), the sync engine, and conflict
surfacing in history. Verified live, and cross-device `/join` verified for real
with two browser contexts — which turned up a genuine first-run bug, now fixed
([sync.md's gotchas](sync.md#gotchas)).

- [ ] Custom domain — blocked on the owner pointing DNS at Cloudflare. Cosmetic.

## Phase 4 — Receipts ← next
- [x] **Scan a receipt into the expense form** — [receipt-scanning.md](receipt-scanning.md),
      [ADR-0016](decisions/0016-receipts.md). Needs no
      storage: the photo is read and thrown away. Button, states, privacy
      line, and a who-had-what screen for line items — where a "×2" line
      unfolds into separately assignable portions
      ([ADR-0016](decisions/0016-receipts.md)) —
      all live.
- [ ] Multi-image capture, on-device downscale
- [ ] R2 upload via the worker, Wi-Fi-only default, queue UI
- [ ] Gallery + full-screen viewer

## Phase 5 — History surfaces ✅
Per-entry revision timeline with field diffs and a group activity feed, read
only ([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md) dropped
restore-to-version). Landed alongside Phase 7; `lib/history-copy.ts` holds the
wording.

## Phase 6 — Finish
- [ ] CSV export
- [ ] Categories
- [x] Install prompt — `lib/install.ts` + `components/install.tsx`
- [x] The two ways a real trip loses data: storage evicted under a phone
      (`lib/persist.ts`) and sync failing where nothing said so (`useSyncHealth`)
- [ ] Empty states, the rest of the error states
- [ ] Answer the open questions in [product.md](product.md#open-questions)

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
`/g/members` (`components/name-adder.tsx`); the offline banner shows the moment
the phone is offline, and opening a group asks the server rather than waiting
for the loop; and a scan that can't reach the network says so instead of
blaming the photo.

## Phase 7 — The owner's punch list ✅ *(2026-08-27)*
Eight items after a day of living with the deployed MVP: one bottom bar, a
neutral dark theme, in-group options, identity history, nothing selectable, a
real amount input, generic placeholders, and co-sponsored expenses. All landed,
then reshaped by three rounds of follow-ups on 2026-08-28 — ADRs
[0011](decisions/0003-link-only-access.md)–[0015](decisions/0005-money-and-currency.md)
carry what changed and why.

## Later, deliberately
Restaurant bill splitting · recurring expenses · push notifications ·
real-time collaboration · spend analytics. (Receipt OCR left this list on
2026-08-28 — it's Phase 4 now.) Seams described in
[product.md](product.md#deliberately-not-in-the-mvp). Don't pre-build them.
