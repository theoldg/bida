# Roadmap

*For: an agent starting a session and looking for the next job.*

Work the phases in order. Don't start a phase before the previous one's tests
pass — the later phases assume the earlier ones are trustworthy.

Tick boxes as you go, and update **Current state** in [CLAUDE.md](../CLAUDE.md).

---

## Phase 0 — Groundwork *(current)*

- [x] Hosting investigated and decided ([hosting.md](hosting.md))
- [x] MVP scope agreed ([product.md](product.md))
- [x] Design mockups produced and published
- [x] Docs skeleton
- [ ] **Design signed off by the owner** ← blocking everything below
- [ ] Monorepo scaffold: pnpm workspace, `apps/web`, `apps/api`, `packages/core`
- [ ] Tailwind + shadcn init with the mockup's tokens ported

## Phase 1 — The domain core

No UI. No network. Pure functions and tests. This is where correctness is won.

- [ ] `core/money.ts` — minor units, ISO 4217 exponents, formatting
- [ ] `core/hlc.ts` — hybrid logical clock, send/receive, ordering
- [ ] `core/ops.ts` — op types, validation
- [ ] `core/fold.ts` — fold ops → entities, per-field LWW, out-of-order tolerant
- [ ] `core/split.ts` — four modes, deterministic remainder distribution
- [ ] `core/balance.ts` — balances from expenses + settlements
- [ ] `core/settle.ts` — greedy minimal-ish transfer set
- [ ] Property tests: any permutation of ops folds identically

## Phase 2 — Local-first app, no server

Fully usable on one device with no backend at all. Ship this to your own phone
and use it for a week before building the server.

- [ ] Dexie schema, materialised stores, rebuild-from-ops
- [ ] `lib/db/commands.ts` — one function per user intent
- [ ] Screens: groups, group/expenses, add expense, split editor, expense detail,
      balances, settle up
- [ ] Personal mode
- [ ] Multi-currency entry with a manually entered rate
- [ ] PWA manifest + shell service worker

## Phase 3 — The server and sync

- [ ] D1 schema + migrations
- [ ] Hono worker: `POST /ops`, `GET /ops`, group create/join
- [ ] Link-only auth: secret in fragment, `sha256` on the server
- [ ] Sync engine: single-flight, backoff, triggers
- [ ] Conflict surfacing in history ("Sam's change was overwritten")
- [ ] Deploy; custom domain

## Phase 4 — Receipts

- [ ] Multi-image capture, on-device downscale
- [ ] R2 upload via the worker, Wi-Fi-only default, queue UI
- [ ] Gallery + full-screen viewer

## Phase 5 — History surfaces

- [ ] Per-expense revision timeline with field diffs
- [ ] Group activity feed
- [ ] Restore-to-version (as a forward `restore` op)

## Phase 6 — Finish

- [ ] CSV export
- [ ] Categories
- [ ] Empty states, error states, install prompt
- [ ] Answer the open product questions in [product.md](product.md#open-product-questions)

---

## Later, deliberately

Restaurant bill splitting · AI receipt OCR and natural-language entry · recurring
expenses · push notifications · real-time collaboration · spend analytics.

Each has a designed seam described in
[product.md](product.md#deliberately-not-in-the-mvp). Don't pre-build them.
