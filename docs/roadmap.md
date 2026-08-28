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

## Phase 2 — Local-first app, no server ✅

Fully usable on one device with no backend at all — but not yet shippable; see
Phase 3. Build it local-first anyway: the server is a replica of the op log, not
the source of truth, so writing the UI against IndexedDB first is the shortest
path to both.

- [x] Dexie schema, materialised stores, rebuild-from-ops
- [x] `lib/db/commands.ts` — one function per user intent
- [x] Screens: groups, group/expenses, add expense, split editor, expense detail,
      balances, settle up, members, version history
- [x] `/join` screen — landing for a shared link, claims a member slot *(now
      pulls the group via sync and recovers on its own if the first attempt
      fails — see [sync.md](sync.md#gotchas))*
- [x] Settings screen — theme, personal mode
- [x] Personal mode — confirmed wired into the built screens
- [x] Multi-currency entry with a manually entered rate — confirmed wired in
- [x] PWA manifest + shell service worker
- [x] Screenshot harness for reviewing screens without a human — `pnpm shots`
      ([testing.md](testing.md#pnpm-shots--photograph-every-screen))

See [implementation-status.md](implementation-status.md) for the exact
per-screen state.

## Phase 3 — The server and sync ✅ *(deployed 2026-08-27 — MVP complete)*

- [x] Minimal deploy: one Worker serving the static export, live at
      <https://hajsik.hajsik-api.workers.dev>
- [x] D1 schema + migrations (`apps/api/migrations/0001_init.sql`) — the
      `hajsik` D1 database is created and migrated on Cloudflare
- [x] Hono worker: `POST /api/groups/:id/ops`, `GET /api/groups/:id/ops` — group
      creation is implicit on a group's first push, no separate endpoint
      (see [sync.md](sync.md#the-protocol))
- [x] Link-only auth: secret in fragment, `sha256` bearer-token check on the
      server (`apps/api/src/auth.ts`)
- [x] Sync engine: single-flight, backoff, triggers (`apps/web/lib/db/sync.ts`)
- [x] Conflict surfacing in history — the losing edit and its author appear as
      an ordinary revision. The explicit "later overwritten by Marie's edit"
      note was dropped on 2026-08-28 as visual noise; the data behind it stays
      (see [sync.md](sync.md#conflicts))
- [x] **Deployed and verified live** — `POST`/`GET /api/groups/:id/ops` smoke
      tested directly against production (create, idempotent re-push, pull,
      wrong-secret rejection all correct), and a real group with members and
      an expense was seen synced through it within minutes of deploy
- [x] **Real cross-device `/join` verified** *(2026-08-27, two browser
      profiles against a local `wrangler dev` + D1)* — this had only been
      exercised as a mocked-`fetch` unit test before; running it for real
      turned up a genuine bug (a first-time user's join screen could dead-end
      if its one-shot sync attempt failed), now fixed — see
      [sync.md's gotchas](sync.md#gotchas)
- [ ] Custom domain — blocked on the owner pointing a domain at Cloudflare DNS;
      not something an agent session can do alone. `workers.dev` doesn't expire,
      so this is cosmetic, not blocking.

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

## Phase 7 — the owner's punch list ✅ *(done 2026-08-27)*

Eight things the owner asked for after living with the deployed MVP for a day —
navigation, dark theme, in-group options, identity history, text selection, the
amount input, placeholder copy, and co-sponsored expenses. Each is specified,
ordered and tracked item by item in **[punchlist.md](punchlist.md)**, which is
the file to open when picking this up cold.

Two follow-ups on 2026-08-28, both on `main`: the bottom bar is pinned again on
screens taller than the viewport (the shell takes `height`, not `min-height` —
[frontend.md's gotchas](frontend.md#gotchas)), and identity claims moved onto
the shared op log so every edit's `actor` is auditable
([ADR-0011](decisions/0011-identity-changes-are-public.md), superseding
ADR-0009, which reopens and answers punch-list item 4).

---

## Later, deliberately

Restaurant bill splitting · AI receipt OCR and natural-language entry · recurring
expenses · push notifications · real-time collaboration · spend analytics.

Each has a designed seam described in
[product.md](product.md#deliberately-not-in-the-mvp). Don't pre-build them.
