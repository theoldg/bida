# Docs

Read in whatever order your task needs. Each doc says at the top who it's for.

## Orientation

| Doc | Read it when |
|---|---|
| [standing-instructions.md](standing-instructions.md) | **Before anything else.** The owner's own instructions on how this project is run |
| [product.md](product.md) | You need to know what we're building and what's out of scope |
| [implementation-status.md](implementation-status.md) | **You're starting a session.** How far the build actually got, and the exact next action |
| [roadmap.md](roadmap.md) | You want the plan the phases follow |
| [architecture.md](architecture.md) | You need the shape of the system before touching it |

## Building

| Doc | Read it when |
|---|---|
| [data-model.md](data-model.md) | You're touching entities, money, splits, or the D1 schema |
| [sync.md](sync.md) | You're touching the op log, offline behaviour, or version history |
| [frontend.md](frontend.md) | You're writing UI, routing, or PWA/service-worker code |
| [design-system.md](design-system.md) | You're writing anything the user will look at |
| [hosting.md](hosting.md) | You're deploying, or worrying about cost and limits |
| [conventions.md](conventions.md) | You're about to commit |

## Decisions

[decisions/](decisions/) holds ADRs — one file per architectural choice, with the
alternatives we rejected and why. Read the relevant one before reversing anything.

- [0001 — Cloudflare Workers + D1 + R2](decisions/0001-cloudflare-workers-d1-r2.md)
- [0002 — Local-first, append-only operation log](decisions/0002-append-only-op-log.md)
- [0003 — Link-only access, no user accounts](decisions/0003-link-only-access.md)
- [0004 — Static export, secrets in the URL fragment](decisions/0004-static-export-fragment-routing.md)
- [0005 — Per-expense currency with a locked rate](decisions/0005-locked-fx-rate.md)
- [0006 — Per-field last-write-wins, not a CRDT library](decisions/0006-lww-not-crdt.md)
