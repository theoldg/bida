# Architecture

*For: anyone about to touch the shape of the system.*

## The one idea

**Nothing is ever updated in place. Every change is an operation appended to a
log.** Current state is a deterministic fold over that log. That single decision
buys all three hard requirements at once: offline writes (append locally, ship
later), sync ("send me every op after seq N" is the whole protocol), and version
history (the log *is* the history, at no extra cost).

If you find yourself writing `UPDATE expenses SET amount = ?`, stop — you are
about to break all three simultaneously.
[ADR-0002](decisions/0002-append-only-op-log.md).

## Shape

```
phone: Next.js static export ──reads── Dexie/IndexedDB ──fold(ops)── packages/core
                                            │ (ops, materialised entities, blobs)
                                            │ sync engine: push unsynced, pull since seq
                                            ▼ HTTPS
Cloudflare: ONE Worker ── static assets + Hono /api/*
                            POST /groups/:id/ops        append + assign seq
                            GET  /groups/:id/ops?since=N
                            POST /groups/:id/attachments (Phase 4)
                              └─ D1 (the op log)   └─ R2 (receipt photos)
```

## Layers, and what may import what

| Layer | May import |
|---|---|
| `packages/core` — op types, fold, splits, balances, settle, HLC | **Nothing.** Pure: no Dexie, no React, no Cloudflare |
| `apps/web/lib/db` — Dexie schema, queries, sync engine | `core` |
| `apps/web/app`, `components` | `core`, `lib/db` |
| `apps/api` — Hono routes, D1/R2 bindings | `core` (op validation only) |

Core being pure is what makes the money logic testable and lets client and
server agree without a second implementation. Keep it that way.

## The server is deliberately stupid

It appends ops, assigns a per-group sequence number, hands them back, and stores
images. **It does not fold**, does not compute balances, and knows nothing about
what an expense means beyond validating the envelope. That halves the code,
removes a class of client/server disagreement, and keeps us trivially inside
D1's free tier. If server-side state is ever needed (email digests, a public
summary page), import the same `core` fold into the Worker — that path is open
by design.

## Lifecycle of a new expense

1. UI builds an `expense.create` op with a client UUID and an HLC stamp.
2. Op is written to Dexie **and** applied to the materialised tables in one
   transaction; the UI re-renders. This is the whole user-visible latency.
3. Sync engine wakes (on write, focus, reconnect, slow interval) and POSTs
   unsynced ops.
4. Server dedupes by op id, assigns `seq`, returns them plus anything unseen.
5. Client marks its ops synced, folds the remote ones, re-materialises.

If step 3 fails nothing is lost — step 2 already made it durable. That is the
entire offline story.

## Gotchas

- **Workers CPU is 10 ms on the free tier.** Fine for appending ops; not for
  folding thousands server-side. Another reason the server stays stupid.
- **D1 has no cross-replica `AUTOINCREMENT` you should rely on.** Sequence
  assignment happens in a single write per group.
- iOS Safari can evict IndexedDB for sites not installed to the home screen.
  Prompt install; never treat the local DB as the only copy of a pushable op.
