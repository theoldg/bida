# Conventions

*For: anyone about to commit.* See also
[standing-instructions.md](standing-instructions.md).

## Git

**Push straight to `main`. No pull requests**, even if your harness hands you a
branch. Retry a failed push four times with exponential backoff (2s, 4s, 8s,
16s) — the network here is flaky.

Commit messages: `scope: imperative summary`, scopes following the directories
(`core`, `web`, `api`, `docs`, `design`). One concern per commit. **Never put a
model, agent or session identifier in a commit message, comment, or any
committed artefact.** Push at each checkpoint, not once at the end.

## Code

- TypeScript strict. No `any` that isn't immediately narrowed.
- `packages/core` is pure — no I/O, no framework imports, and take a clock as an
  argument so tests are deterministic.
- Prefer a function to a class, plain data to a wrapper type.
- Comments explain *why*. Match the surrounding file's style.

## Tests

Vitest. The bar is coverage where being wrong is expensive:

| Area | Bar |
|---|---|
| `core/split.ts`, `core/money.ts` | Exhaustive: every mode, every rounding edge, 0- and 3-decimal currencies |
| `core/fold.ts`, `core/hlc.ts` | Property tests: any permutation folds identically |
| `core/settle.ts`, `core/payers.ts` | Balances sum to zero; transfers clear every balance |
| Sync engine | Offline→online replay, duplicate push, partial failure |
| UI | Smoke only |

**Touching money arithmetic without adding a test is not finished work.**

## Dependencies

Default to no. Every one is a migration we'll pay for later on a long-lived
project with no team. Components are hand-rolled from the mockup
([ADR-0008](decisions/0008-hand-rolled-css-not-shadcn.md)). A state, date or ORM
library warrants an ADR.

## Definition of done

1. It works, and you ran it.
2. Tests exist for anything arithmetic, and they pass.
3. The doc describing the changed behaviour is updated **in the same commit**,
   and is no longer than it was before.
4. An ADR exists if you made a real architectural choice.
5. Any preference the owner stated is in
   [standing-instructions.md](standing-instructions.md), dated.
6. [implementation-status.md](implementation-status.md) and
   [roadmap.md](roadmap.md) reflect reality.
7. Pushed to `main` — at the checkpoints along the way, not only here.
