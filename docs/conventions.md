# Conventions

*For: anyone about to commit.*

## Git

See also [standing-instructions.md](standing-instructions.md) for the owner's
requests in their own words.

**Push straight to `main`. Do not open pull requests.** The owner has said this
explicitly: they don't want to review merges on a personal project. If your
harness hands you a feature branch, use `main` anyway.

```bash
git add -A
git commit -m "sync: fold ops by HLC order"
git push -u origin main
```

Retry a failed push up to four times with exponential backoff (2s, 4s, 8s, 16s)
before reporting a problem — the network here is occasionally flaky.

**Push frequently.** Commit and push at each meaningful checkpoint — a working
module, a finished screen, a decision recorded — rather than batching a session
into one commit at the end. If a session dies halfway, its finished work should
already be on `main`.

**Commit messages**: `scope: imperative summary`. Scopes follow the directories —
`core`, `web`, `api`, `docs`, `design`. One concern per commit; don't bundle a
refactor into a feature. Never put a model name, agent name, or session
identifier into a commit message, code comment, or any other committed artifact.

## Code

- TypeScript strict. No `any` that isn't immediately narrowed.
- `packages/core` is pure — no I/O, no framework imports, no `Date.now()` passed
  implicitly (take a clock as an argument so tests are deterministic).
- Prefer a function to a class. Prefer plain data to a wrapper type.
- Comments explain *why*. The code already says what.
- Match the surrounding file's style over your own preference.

## Tests

Vitest. The bar is not uniform coverage — it's coverage where being wrong is
expensive:

| Area | Bar |
|---|---|
| `core/split.ts`, `core/money.ts` | Exhaustive. Every mode, every rounding edge, 0- and 3-decimal currencies |
| `core/fold.ts`, `core/hlc.ts` | Property tests: any permutation of the same ops folds to the same state |
| `core/settle.ts` | Balances sum to zero; transfers clear every balance |
| Sync engine | Offline→online replay, duplicate push, partial failure |
| UI | Smoke only |

**Touching money arithmetic without adding a test is not finished work.**

## Dependencies

Default to no. Every dependency is a migration we'll pay for later on a project
with a long life and no team. Components are hand-rolled from the mockup
rather than pulled from a UI library — see
[ADR-0008](decisions/0008-hand-rolled-css-not-shadcn.md). Adding a state
library, a date library, or an ORM warrants an ADR.

## Definition of done

1. It works, and you ran it.
2. Tests exist for anything arithmetic, and they pass.
3. The doc describing the changed behaviour is updated **in the same commit**.
4. An ADR exists if you made a real architectural choice.
5. Any preference the owner stated this session is in
   [standing-instructions.md](standing-instructions.md), dated.
6. `docs/roadmap.md` and CLAUDE.md's *Current state* reflect reality.
7. Pushed to `main` — and pushed at the checkpoints along the way, not only here.
