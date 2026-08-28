# Roadmap

*For: an agent looking for the next job. Tick boxes as you go.*

**The MVP is Phases 0–3 inclusive** — an app that only works on the phone it was
typed into is a notebook. Phases 4–6 are the finish, not the product.

## Phase 0 — Groundwork ✅
Hosting decided, MVP scope agreed, mockups produced and **signed off**
(2026-08-27), pnpm workspace with `packages/core`, `apps/web`, `apps/api`,
Tailwind carrying the mockup's tokens.

## Phase 1 — Domain core ✅ *(111 tests)*
`money`, `hlc`, `ops`, `fold`, `split`, `payers`, `balance`, `settle`, plus
property tests that any permutation of ops folds identically.

## Phase 2 — Local-first app ✅
Dexie schema and rebuild-from-ops, `lib/db/commands.ts`, every screen, `/join`,
settings, personal mode, multi-currency entry, PWA manifest + shell service
worker, and `pnpm shots`.

## Phase 3 — Server and sync ✅ *(deployed 2026-08-27 — MVP complete)*
One Worker serving the export and the API, D1 schema + migrations, the two op
endpoints, link-only auth (`sha256` bearer check), the sync engine, and conflict
surfacing in history. Verified live, and cross-device `/join` verified for real
with two browser contexts — which turned up a genuine first-run bug, now fixed
([sync.md's gotchas](sync.md#gotchas)).

- [ ] Custom domain — blocked on the owner pointing DNS at Cloudflare. Cosmetic.

## Phase 4 — Receipts ← next
- [ ] **Scan a receipt into the expense form** — plan in
      [receipt-scanning.md](receipt-scanning.md). Needs no storage, so it comes
      first: the photo is read and thrown away
- [ ] Multi-image capture, on-device downscale
- [ ] R2 upload via the worker, Wi-Fi-only default, queue UI
- [ ] Gallery + full-screen viewer

## Phase 5 — History surfaces ✅
Per-expense revision timeline with field diffs, group activity feed, and
restore-as-a-forward-op. Landed alongside Phase 7; `lib/history-copy.ts` holds
the shared wording.

## Phase 6 — Finish
- [ ] CSV export
- [ ] Categories
- [ ] Empty states, error states, install prompt
- [ ] Answer the open questions in [product.md](product.md#open-product-questions)

## Phase 7 — The owner's punch list ✅ *(2026-08-27)*
Eight items after a day of living with the deployed MVP: one bottom bar, a
neutral dark theme, in-group options, identity history, nothing selectable, a
real amount input, generic placeholders, and co-sponsored expenses. All landed,
then reshaped by three rounds of follow-ups on 2026-08-28 — ADRs
[0011](decisions/0011-identity-changes-are-public.md)–[0015](decisions/0015-one-money-field-core-reports-numbers.md)
carry what changed and why.

## Later, deliberately
Restaurant bill splitting · recurring expenses · push notifications ·
real-time collaboration · spend analytics. (Receipt OCR left this list on
2026-08-28 — it's Phase 4 now.) Seams described in
[product.md](product.md#deliberately-not-in-the-mvp). Don't pre-build them.
