# CLAUDE.md — start here

**bida** is a Tricount-style shared-expense app: mobile web / PWA, local-first,
hosted for free. Read this, then the doc your task points at.

## Non-negotiables

1. **Worktree first, then `pnpm session`** — in that order, as the first
   commands of every session, whatever the task: a question, a key to make, a
   pull. **This knowingly contradicts the harness**, which assigns a
   `claude/…` branch and says to push there. That is the owner's conscious
   preference, not an oversight: here, `dev` wins. The owner keeps editing the main clone while you work, so take a
   working tree of your own with your harness's worktree tool. `pnpm session`
   is `pnpm install` (which wires up the `pre-push` hook that runs `pnpm check`
   — without it a push leaves unverified and says nothing) plus
   `scripts/on-dev.sh`, which settles the branch. This project pushes directly
   to `dev`, not to a harness-assigned branch nobody looks at
   ([standing-instructions](docs/standing-instructions.md#workflow)). No pull
   requests, and `main` moves only by the owner's hand. **Push with `git push origin HEAD:dev`** — a worktree cannot hold the
   `dev` branch itself, so the push has to say where it lands.
2. **Commit and push at every checkpoint**, not once at the end.
3. **Docs change in the same commit as the code.** See [Doc upkeep](#doc-upkeep).
4. **Money is never a float.** Integer minor units everywhere, and always
   positive — an income's sign is applied in `computeBalances` and nowhere else.
   [docs/data-model.md](docs/data-model.md#money).
5. **Never mutate an entity in place.** Every change is an appended op — that
   one rule buys sync, offline and history. [docs/sync.md](docs/sync.md).

The owner's standing preferences: [docs/standing-instructions.md](docs/standing-instructions.md).
Obey them; adding one is rare and has a bar at the head of that file.

## Where things are

| Path | What |
|---|---|
| `packages/core/` | Pure domain logic: money, HLC, ops, folding, splits, payers, balances, settle-up, history, invariants, sealing, import/export, the scan prompt, notifications |
| `apps/web/` | Next.js App Router, static export — every screen |
| `apps/api/` | Cloudflare Worker: static assets + Hono sync API + D1 |
| `docs/` | Start at [docs/README.md](docs/README.md) |
| `docs/decisions/` | ADRs. Read before arguing with an architectural choice |
| `docs/invariants.md` | Which invariants survive a merge, and what holds each — read before adding a check that reads other entities |
| `scripts/` | The two runners (`check`, `verify`), the browser checks the second drives (`entries`, `claim`, `keyboard`, `offline`, `stall`, `homescreen`, `demo`, `nav`, `tricount`) and `shots`/`readme-shots` on a shared harness, plus `drive` (the app as text), `icons`, `docs-check`, `rules-check`, `version`, `on-dev`, `release` — [testing.md](docs/testing.md) lists them all |

## Stack

Next.js (`output: 'export'`) + hand-written CSS + hand-rolled components
([ADR-0008](docs/decisions/0008-hand-rolled-interface.md)), served with a
Hono API by one Cloudflare Worker. Data is an append-only op log in IndexedDB
(Dexie), synced to D1 **sealed** — the server cannot read a group
([ADR-0036](docs/decisions/0036-the-server-cannot-read-a-group.md)). No accounts
— a group is a secret link, and that link is the key as well. [architecture.md](docs/architecture.md) ·
[hosting.md](docs/hosting.md).

## Current state

The app is built, deployed and syncing in production. A group
holds three kinds of entry — expense, income, transfer
([ADR-0010](docs/decisions/0010-what-an-entry-is.md)), state two phones can
merge into that no check can prevent is named and repaired by
[docs/invariants.md](docs/invariants.md), and what syncs is encrypted end to
end. **The D1 log is finished data** — it is never reset again ([standing-instructions](docs/standing-instructions.md#product)).

**Exact state and next action live in
[docs/implementation-status.md](docs/implementation-status.md)** — not here, so
this file can't go stale.

```bash
pnpm session && pnpm check
```

## Working agreements

- **Commits.** `scope: imperative summary` (`core`, `web`, `api`, `docs`),
  one concern each. Retry a failed push four times with backoff (2/4/8/16s).
  **A push deploys, so it carries a version**: `pnpm bump` before pushing, which
  the gate insists on. The middle number is your call and the first one is the
  owner's alone — [hosting.md](docs/hosting.md#versions).
- **Automation.** The `pre-push` hook (`.githooks/`) — see
  [Non-negotiables](#non-negotiables) for why it needs `pnpm session` first —
  runs `pnpm check`: doc links, the invariants in `scripts/rules-check.mjs`, the
  version, typecheck, tests and the static export build — six stages at once,
  ~30s. Nothing else gates a push, so anything you want caught belongs in it.
  `pnpm verify` drives the built app in a real browser and `pnpm shots`
  photographs it — [testing.md](docs/testing.md). A push to `dev` auto-deploys
  to the dev Worker; production moves when the owner fast-forwards `main` —
  [hosting.md](docs/hosting.md#dev-and-production).
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
  long-lived project with no team. A state, date or ORM library is an ADR.
- **Scope.** Restaurant bill splitting and AI features are deferred
  ([product.md](docs/product.md#deliberately-not-in-the-mvp)). Leave the seams,
  build none of it.

**Done means:** `pnpm check` passes · arithmetic has passing tests · the doc
describing the changed behaviour is updated in the same commit · a preference
that clears the bar is in standing-instructions, dated · implementation-status
reflects reality · pushed to `dev`.

## Doc upkeep

These docs exist so a cold agent is useful in five minutes. That decays unless
every session pays in. **Before you finish:**

1. Changed behaviour → update the doc that describes it, in the same commit.
2. Made a choice expensive to reverse that someone might argue with → **edit
   the ADR on that subject** so it says where we stand now.
3. Learned something the hard way → one line in the relevant **Gotchas**
   section.
4. Update [implementation-status.md](docs/implementation-status.md) if what is
   built or what is open moved.
5. **Touch [claude_corner.md](docs/claude_corner.md)** — every session, at
   least a line. The agents' own doc: how the owner asks, and what an agent
   gets wrong that no check catches. Vibes only, nothing technical. Its three
   limits — 100 lines, twelve postcards, 300 characters each — are checked, so
   adding means evicting: fold what the evicted postcard taught into the prose
   above if it has gone general, otherwise let it go.

**A new ADR and a new standing instruction are the two things a session almost
never adds.** Each file states its own bar — [decisions/](docs/decisions/README.md)
and [standing-instructions.md](docs/standing-instructions.md) — and both start
from *no*. Most of what a session wants to record is neither: it is a Gotcha, a
line in the doc describing the thing, or already said by the code. If you do add
one, say so in your summary, so the owner sees the list grow rather than finding
it later.

**Keep them short.** Nothing counts the lines, so it is on you. The rule that
does most of the work is **one fact, one home**: before writing a paragraph,
find where the project already says it and edit *that*. These files have
inflated three ways before — an ADR describing the built thing in design-system's
words, a standing instruction restating what the code enforces, and a note about
what changed this session. Prefer editing a line to adding one, delete what the
code says for itself, and cut narrative history: a doc records the state and the
reasoning, not the sessions that got here. Real new behaviour may cost a
paragraph; pay for it by cutting something that has stopped earning its place.
A doc past ~200 lines, or covering two subjects, wants splitting or cutting.
