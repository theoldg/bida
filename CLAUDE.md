# CLAUDE.md — start here

**Hajsik** is a Tricount-style shared-expense app: mobile web / PWA, local-first,
hosted for free. Read this, then the doc your task points at.

## Non-negotiables

1. **Push directly to `main`. No pull requests.** If your harness assigns a
   feature branch, ignore it.
2. **Run `pnpm install` before your first push, every session.** A fresh
   clone/container has no `node_modules` and no `core.hooksPath` — the
   `pre-push` hook that runs `pnpm check` literally cannot fire until install
   has, so a push before then leaves with zero local verification and no
   error telling you so. Installing is also what wires the hook up
   (`postinstall`), so this is a do-it-once-per-session, not a per-push step.
3. **Commit and push at every checkpoint**, not once at the end.
4. **Docs change in the same commit as the code.** See [Doc upkeep](#doc-upkeep).
5. **Money is never a float.** Integer minor units everywhere, and always
   positive — an income's sign is applied in `computeBalances` and nowhere else.
   [docs/data-model.md](docs/data-model.md#money).
6. **Never mutate an entity in place.** Every change is an appended op — that
   one rule buys sync, offline and history. [docs/sync.md](docs/sync.md).

The owner's standing preferences: [docs/standing-instructions.md](docs/standing-instructions.md).
Append to it whenever they state a new one.

## Where things are

| Path | What |
|---|---|
| `packages/core/` | Pure domain logic: money, HLC, ops, folding, splits, payers, balances, settle-up, history |
| `apps/web/` | Next.js App Router, static export — every screen |
| `apps/api/` | Cloudflare Worker: static assets + Hono sync API + D1 |
| `docs/` | Start at [docs/README.md](docs/README.md) |
| `docs/decisions/` | ADRs. Read before arguing with an architectural choice |

## Stack

Next.js (`output: 'export'`) + Tailwind + hand-rolled components
([ADR-0008](docs/decisions/0008-hand-rolled-interface.md)), served with a
Hono API by one Cloudflare Worker. Data is an append-only op log in IndexedDB
(Dexie), synced to D1. R2 for receipts, not built. No accounts — a group is a
secret link. [architecture.md](docs/architecture.md) ·
[hosting.md](docs/hosting.md).

## Current state

MVP (Phases 0–3) complete, deployed and synced in production; the owner's punch
list and follow-ups landed through 2026-08-30, and a group now holds three kinds
of entry — expense, income, transfer
([ADR-0010](docs/decisions/0010-what-an-entry-is.md)). Next: Phase 4
(receipts).

**Exact state and next action live in
[docs/implementation-status.md](docs/implementation-status.md)** — not here, so
this file can't go stale.

```bash
pnpm install && pnpm --filter @hajsik/core test
```

## Working agreements

- **Commits.** `scope: imperative summary` (`core`, `web`, `api`, `docs`,
  `design`), one concern each. Never put a model, agent or session identifier in
  anything committed. Retry a failed push four times with backoff (2/4/8/16s).
- **Automation.** The `pre-push` hook (`.githooks/`) — see
  [Non-negotiables](#non-negotiables) for why it needs `pnpm install` first —
  runs `pnpm check`. Push to `main` then auto-deploys —
  [hosting.md](docs/hosting.md#deploying).
- **Code.** TypeScript strict, no un-narrowed `any`. `packages/core` is pure —
  no I/O, no framework, and take a clock as an argument. Prefer a function to a
  class, plain data to a wrapper. Comments explain *why*.
- **Tests** (vitest). Coverage where being wrong is expensive: exhaustive on
  `core/split.ts` and `core/money.ts` (every mode, every rounding edge, 0- and
  3-decimal currencies); property tests on `core/fold.ts` and `core/hlc.ts` (any
  permutation folds identically); `settle`/`payers` must clear every balance to
  zero; sync engine covers offline→online replay, duplicate push, partial
  failure; UI smoke only. **Touching money arithmetic without a test is not
  finished work.**
- **Dependencies.** Default to no — each is a migration we'll pay for on a
  long-lived project with no team. A state, date or ORM library warrants an ADR.
- **Scope.** Restaurant bill splitting and AI features are deferred
  ([product.md](docs/product.md#deliberately-not-in-the-mvp)). Leave the seams,
  build none of it.

**Done means:** it works and you ran it · arithmetic has passing tests · the doc
describing the changed behaviour is updated in the same commit and is no longer
than before · an ADR exists if you made a real architectural choice · any
preference the owner stated is in standing-instructions, dated ·
implementation-status and roadmap reflect reality · pushed to `main`.

## Doc upkeep

These docs exist so a cold agent is useful in five minutes. That decays unless
every session pays in. **Before you finish:**

1. Changed behaviour → update the doc that describes it, in the same commit.
2. Made an architectural choice worth defending → write an ADR. Never edit an
   accepted one; supersede it.
3. Owner stated a preference → append it to
   [standing-instructions.md](docs/standing-instructions.md), dated.
4. Learned something the hard way → one line in the relevant **Gotchas**
   section.
5. Update [implementation-status.md](docs/implementation-status.md) and the
   roadmap checkboxes.

**Keep them tight.** Every session should leave the docs slightly better *and no
longer*: prefer editing a line to adding one, delete what the code now says for
itself, and cut narrative history — a doc records the state and the reasoning,
not the sequence of sessions that got here. If a doc passes ~200 lines or covers
two subjects, split it or cut it.
