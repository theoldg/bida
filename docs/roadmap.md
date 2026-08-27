# Roadmap

*For: an agent starting a session and looking for the next job.*

Work the phases in order. Don't start a phase before the previous one's tests
pass — the later phases assume the earlier ones are trustworthy.

**The MVP is Phases 0-3 inclusive.** A shared-expense app that only works on the
phone it was typed into is a notebook. The server and sync are not a "later"
nicety — the app is not shippable until a second person can open the link and
see the same ledger. Phases 4-6 are the finish, not the product.

Tick boxes as you go, and update **Current state** in [CLAUDE.md](../CLAUDE.md).

---

## Phase 0 — Groundwork ✅

- [x] Hosting investigated and decided ([hosting.md](hosting.md))
- [x] MVP scope agreed ([product.md](product.md))
- [x] Design mockups produced and published
- [x] Docs skeleton
- [x] **Design signed off by the owner** — *2026-08-27, "i approve of your design, go wild"*
- [x] Monorepo scaffold: pnpm workspace + `packages/core`
- [x] `apps/web`, `apps/api` packages — both created
- [x] Tailwind init with the mockup's tokens ported *(no shadcn — see
      [ADR-0008](decisions/0008-hand-rolled-css-not-shadcn.md))*

## Phase 1 — The domain core ✅ *(88 tests passing)*

No UI. No network. Pure functions and tests. This is where correctness is won.

- [x] `core/money.ts` — minor units, ISO 4217 exponents, formatting
- [x] `core/hlc.ts` — hybrid logical clock, send/receive, ordering
- [x] `core/ops.ts` — op types, validation
- [x] `core/fold.ts` — fold ops → entities, per-field LWW, out-of-order tolerant
- [x] `core/split.ts` — four modes, deterministic remainder distribution
- [x] `core/balance.ts` — balances from expenses + settlements
- [x] `core/settle.ts` — greedy minimal-ish transfer set
- [x] Property tests: any permutation of ops folds identically

## Phase 2 — Local-first app, no server *(current)*

Fully usable on one device with no backend at all — but not yet shippable; see
Phase 3. Build it local-first anyway: the server is a replica of the op log, not
the source of truth, so writing the UI against IndexedDB first is the shortest
path to both.

- [x] Dexie schema, materialised stores, rebuild-from-ops
- [x] `lib/db/commands.ts` — one function per user intent
- [x] Screens: groups, group/expenses, add expense, split editor, expense detail,
      balances, settle up, members, version history
- [ ] `/join` screen — landing for a shared link, claims a member slot
- [ ] Settings screen
- [ ] Personal mode — confirm wired into the built screens
- [ ] Multi-currency entry with a manually entered rate — confirm wired in
- [ ] PWA manifest + shell service worker — **paused for the MVP**, see
      [standing-instructions.md](standing-instructions.md#skip-pwa-icons-for-the-mvp)
- [ ] Screenshot harness for reviewing screens without a human
      ([testing.md](testing.md))

See [implementation-status.md](implementation-status.md) for the exact
per-screen state.

## Phase 3 — The server and sync *(still the MVP)*

- [x] Minimal deploy: one Worker serving the static export, live at
      <https://hajsik.hajsik-api.workers.dev> — no D1/R2 bindings yet
- [ ] D1 schema + migrations
- [ ] Hono worker: `POST /ops`, `GET /ops`, group create/join
- [ ] Link-only auth: secret in fragment, `sha256` on the server
- [ ] Sync engine: single-flight, backoff, triggers
- [ ] Conflict surfacing in history ("Sam's change was overwritten")
- [ ] Custom domain

**End of the MVP.** Everything below is the finish.

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
