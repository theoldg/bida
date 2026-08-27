# Architecture

*For: anyone about to touch the shape of the system.*

## The one idea

**Nothing is ever updated in place. Every change is an operation appended to a
log.** Current state is a deterministic fold over that log.

This single decision buys all three of the hard requirements at once:

- *Offline writes* — append locally, ship the ops later.
- *Sync* — "send me every op after seq N" is the entire protocol.
- *Version history* — the log **is** the history. It costs nothing extra.

If you find yourself writing an `UPDATE expenses SET amount = ?`, stop. You are
about to break all three features simultaneously. See
[ADR-0002](decisions/0002-append-only-op-log.md).

## Shape

```
┌─────────────────────── the phone ────────────────────────┐
│  Next.js (static export) + hand-rolled components        │
│         │                                                │
│         │ reads materialised state                       │
│         ▼                                                │
│  ┌─────────────────┐   fold(ops)   ┌──────────────────┐  │
│  │  Dexie / IndexedDB              │  packages/core   │  │
│  │  · ops (local + pulled)  ◄──────┤  pure functions: │  │
│  │  · materialised entities        │  fold, split,    │  │
│  │  · queued image blobs           │  balance, settle │  │
│  └────────┬────────┘               └──────────────────┘  │
│           │ sync engine (push unsynced, pull since seq)   │
└───────────┼──────────────────────────────────────────────┘
            │ HTTPS
┌───────────▼──────────── Cloudflare ──────────────────────┐
│  ONE Worker                                              │
│   ├─ static assets  (the Next.js export)                 │
│   └─ Hono API  /api/*                                    │
│        ├─ POST /groups/:id/ops     append + assign seq   │
│        ├─ GET  /groups/:id/ops?since=N                   │
│        └─ POST /groups/:id/attachments                   │
│           │                    │                         │
│           ▼                    ▼                         │
│      D1 (SQLite)            R2 (images)                  │
│      the op log             receipt photos               │
└──────────────────────────────────────────────────────────┘
```

## Layers, and what may depend on what

| Layer | Contains | May import |
|---|---|---|
| `packages/core` | Op types, fold, split maths, balances, settle-up, HLC | Nothing. Pure. No Dexie, no React, no Cloudflare |
| `apps/web/lib/db` | Dexie schema, queries, the sync engine | `core` |
| `apps/web/app`, `components` | React, hand-rolled components, routing | `core`, `lib/db` |
| `apps/api` | Hono routes, D1 and R2 bindings | `core` (op validation only) |

`packages/core` being pure is what makes the money logic testable and what lets
client and server agree on state without shipping a second implementation. Keep
it that way.

## The server is deliberately stupid

It appends ops, assigns a per-group sequence number, hands them back, and stores
images. **It does not fold.** It does not compute balances. It does not know what
an expense means beyond validating the op envelope.

Why: it halves the code, removes an entire class of client/server disagreement,
and keeps us inside D1's free tier trivially. The cost is that anything needing
server-side state (email digests, a public read-only summary page) will need a
fold on the server later — at which point we import the same `packages/core`
fold into the Worker. That path is open by design.

## Request lifecycle for a new expense

1. User taps Save. UI builds an `expense.create` op with a client-generated
   UUID and a hybrid logical clock stamp.
2. Op is written to Dexie **and** applied to the materialised entity table in
   one transaction. UI re-renders from materialised state. This is the whole of
   the user-visible latency.
3. Sync engine wakes (on write, on focus, on reconnect, and on a slow interval)
   and POSTs unsynced ops.
4. Server dedupes by op id, assigns `seq`, returns the assigned seqs plus any
   ops this client hasn't seen.
5. Client marks its ops synced, folds in the new remote ops, re-materialises.

If step 3 fails, nothing is lost — the op is already durable in step 2, flagged
unsynced. This is the entire offline story.

## Gotchas

*Add to this list every time one bites you.*

- **Workers CPU limit is 10 ms on the free tier.** Fine for appending ops.
  Not fine for folding thousands of ops server-side. Another reason the server
  stays stupid.
- **D1 has no `AUTOINCREMENT` semantics you should rely on across replicas.**
  Sequence assignment happens in a single write transaction per group.
- iOS Safari can evict IndexedDB for sites that aren't installed to the home
  screen. Prompt install; never treat the local DB as the only copy of an op
  that could have been pushed.
