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
                                            │ (ops + the entities they fold into)
                                            │ sync engine: push unsynced, pull since seq
                                            ▼ HTTPS
       (sealed under a key derived from the link secret — ADR-0036)
Cloudflare: ONE Worker ── static assets + Hono /api/*
                            POST /groups/:id/ops        append + assign seq
                            GET  /groups/:id/ops?since=N
                              └─ D1 (the sealed op log)
                            POST /groups/:id/scan       the one endpoint that
                              └─ D1 (scan_hits)         spends money
                            GET  /rates/:from/:to       a rate suggestion
                            POST /tricount             somebody else's ledger
```

The two op endpoints are [sync.md](sync.md#the-protocol); the scan is
[receipt-scanning.md](receipt-scanning.md), and it is the one route that never
parses its body — the photo is streamed between the halves of a prompt the
Worker owns, to stay inside 10 ms of CPU. The last two are passthroughs to
somebody else's server, there because **a page is not allowed to read what
either one answers** — neither reply carries an `Access-Control-Allow-Origin`,
which is a browser shielding its own user from the page in front of them and
not a door anybody is being kept out of. A Worker is not a browser, so it
needs no permission. `/tricount` is what **Import a group** fetches a Tricount
link with ([data-model.md](data-model.md#reading-a-tricount-back)), and the
10 ms is why the throwaway key that handshake wants is made on the phone.

## Layers, and what may import what

| Layer | May import |
|---|---|
| `packages/core` — op types, fold, splits, balances, settle, HLC | **Nothing.** Pure: no Dexie, no React, no Cloudflare |
| `apps/web/lib/db` — Dexie schema, queries, sync engine | `core` |
| `apps/web/app`, `components` | `core`, `lib/db` |
| `apps/api` — Hono routes, D1 binding | `core` — envelope types and `SCAN_LIMITS`; never the fold |

Core being pure is what makes the money logic testable and lets client and
server agree without a second implementation. Keep it that way.

## The server is deliberately stupid, and now deliberately blind

It appends ops, assigns a per-group sequence number and hands them back. **It
does not fold**, does not compute balances, and cannot read an op at all: every
body arrives sealed under a key derived from the link secret, which it never
receives ([ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)). All it
validates is the envelope it routes on.

That halves the code, removes a class of client/server disagreement, and keeps
us trivially inside D1's free tier. It also closes a door that used to be open:
anything wanting to read content — email digests, a public summary page — has to
run on a device that holds a key, or reverse the ADR.

## Lifecycle of a new expense

1. UI builds an `expense.create` op with a client UUID and an HLC stamp.
2. Op is written to Dexie **and** applied to the materialised tables in one
   transaction; the UI re-renders. This is the whole user-visible latency.
3. Sync engine wakes (on write, focus, reconnect, slow interval), seals the
   unsynced ops and POSTs them.
4. Server dedupes by op id, assigns `seq`, returns them plus anything unseen.
5. Client marks its ops synced, folds the remote ones, re-materialises.

If step 3 fails nothing is lost — step 2 already made it durable. That is the
entire offline story.

## Gotchas

- **Workers CPU is 10 ms on the free tier.** Fine for appending ops; not for
  folding thousands server-side. Another reason the server stays stupid.
- **D1 has no cross-replica `AUTOINCREMENT` you should rely on.** Sequence
  assignment happens in a single write per group.
- iOS evicts a tab's IndexedDB after seven days unused, taking the `groupKeys`
  secrets and any unpushed op — never treat the local DB as the only copy of a
  pushable op. Why iOS is its own problem, and what the app does about it: [ios.md](ios.md).
