# Sync, offline, and version history

*For: anyone touching the op log, the sync engine, or history UI.* These are one
subject: the log that syncs is the log that renders history.

## The operation

```ts
type Op = {
  id: string        // client UUID; the idempotency key
  groupId: string
  entity: 'group'|'member'|'expense'|'settlement'|'attachment'|'identity'|'rate'
  entityId: string
  kind: 'create' | 'update' | 'delete' | 'restore'
  patch: Record<string, unknown>   // changed fields ONLY, never the whole entity
  hlc: string       // hybrid logical clock
  actor: string     // memberId
  note?: string     // optional human reason, surfaced in history
  createdAt: number // wall clock, display only — NEVER for ordering
  seq?: number      // assigned by the server; absent = unsynced
}
```

`patch` carrying only changed fields is what lets concurrent edits to different
fields of the same expense merge instead of clobbering.

**A `create` writes no field it would only be defaulting.** The fold treats
absent as the default, so `receiptItems: null` on an expense nobody scanned is
bytes in the log and a row in its own history saying nothing changed — eight
such fields on every ordinary expense, a quarter of the op. `only()` in
`apps/web/lib/db/commands.ts` drops them. The exception is a `rate` create:
its entity id is the currency code, so setting a rate the group had cleared
lands on the tombstoned row and must write `deletedAt: null` to lift it. In an
`update` an absent field means "leave it alone", so clearing one there still
writes the null.

A `rate` op is the odd one: its `entityId` is the currency code rather than a
generated id, because the group holds one rate per currency and everyone has to
land on the same row ([ADR-0005](decisions/0005-money-and-currency.md)). Two
people typing a EUR→MAD rate offline therefore *conflict*, per-field LWW, which
is the point — one number, last word wins, both ops in the history.

## Ordering: hybrid logical clocks

Phone wall clocks are wrong, sometimes by minutes; ordering by `createdAt` lets
a slow clock silently lose every conflict. HLC (`core/hlc.ts`) is
`<physical-ms>-<counter>-<nodeId>`, zero-padded so string comparison equals
causal-ish ordering. On send: `physical = max(now, lastPhysical)`, incrementing
`counter` on a tie. On receive: `max` with the remote physical. `nodeId` is
a random per-device string breaking ties deterministically.

**Receiving is what makes the ordering true**, so `hlcReceive` runs over every
pulled op, in the same transaction that stores them — a device that has seen a
stamp always stamps after it. Skip that and the clock only moves on send: a
peer whose phone runs three hours fast wins every conflict, because the
correction you type after reading their op stamps *before* it and the fold
throws it away.

**Any stamp is adopted, however far ahead it reads.** There is no time limit on
an update: a late or far-future op is still somebody's expense, and refusing it
loses that expense to protect a guarantee adopting it already provides.

**Order by HLC, never by `seq` and never by `createdAt`.** `seq` orders arrival
at the server and answers only "what have I not pulled yet".

## Folding

Sort by `hlc` ascending, then per entity: `create` initialises; `update` assigns
each field in `patch`, **per-field last write wins by HLC**; `delete` sets
`deletedAt` and never removes the row; `restore` applies exactly like an update
— nothing emits one any more
([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)), but groups
in production hold them.

The fold is pure and total: any subset of ops produces *some* valid state. An
`update` arriving before its `create` yields a partial entity that completes
later. Don't throw on out-of-order ops.
[ADR-0002](decisions/0002-append-only-op-log.md) for why LWW and not a CRDT.

## The protocol

Two endpoints — `apps/api/src/index.ts` (routes), `store.ts` (D1), `auth.ts`
(bearer check). Both authenticate with the group secret as a bearer token
([ADR-0003](decisions/0003-link-only-access.md)).

**`POST /api/groups/:id/ops`**
```jsonc
// → { "ops": [ /* unsynced Op[], no seq */ ], "since": 412 }
// ← { "assigned": { "<opId>": 413 }, "ops": [ /* seq > 412, unseen */ ],
//     "latestSeq": 419 }
```
Accepting is idempotent on `Op.id`, which is what makes retry safe on a flaky
connection. **There is no create-group endpoint**: a group's first push
registers it, storing `sha256(secret)` from that request's token, and every
later request is checked against it. A `GET` on a never-pushed group returns
404 — the creating device must sync once before an invite link is pullable.

**`GET /api/groups/:id/ops?since=N`** — the same pull, without a push.

## The sync engine

`apps/web/lib/db/sync.ts`. A single-flight loop triggered by a local write
(debounced ~1 s), `visibilitychange` → visible, `online`, and a 60 s interval
while foregrounded. Backoff 2/4/8 s capped at 60 s, reset on success. Never
block the UI; never let two runs overlap — `syncAll` is single-flight over the
whole run, and an overlapping call gets back the promise already in flight.
A run that attempted nothing must never conclude "no failures" and reset a
backoff the failing run had grown.

**A forgotten group is skipped**, not synced in the background forever. It
keeps its secret: opening the invite link again un-forgets it.

**Every attempt is written down.** A success stamps `groupKeys.lastSyncedAt`
and clears `failure`; a failure increments `failure.count` and keeps the HTTP
status. `useSyncHealth` reads it back, and `/g` says so once `count` reaches 2
— one failure is a dropped packet, two is a server that isn't there. A 403
warns immediately and differently: it means this device's secret no longer
matches the group's, which retrying can never fix and a fresh invite link can
(opening one clears the failure). `navigator.onLine` answers a different
question and only drives the "Offline" banner: it reports a link, not an
answering server, so it is blind to exactly the outage that costs a trip its
ledger.

**Attachments will sync separately** — Wi-Fi-only by default plus a manual
"upload now", with an expense fully synced and correct while its photos are
still queued. Not built: nothing appends an `attachment` op yet (Phase 4).

## Conflicts

Two people editing the same expense while one is offline: **different fields**
both survive, no conflict at all; **the same field**, highest HLC wins the
materialised value and **both ops stay in the log**, so history shows the losing
edit and who made it, in order, like any other revision.

`FieldChange.supersededByOpId` from `core/history.ts` marks which later op
replaced a field, and is tested — but nothing renders it (owner, 2026-08-28:
*"they're visually noisy"*). It's there if a future screen wants it.

We never present a conflict-resolution dialog. For an expense splitter that
would be worse than being briefly wrong — the group can see the history and fix
it in one tap.

## History UI

Falls out of the log with no extra storage. **Per expense**: `ops` filtered by
`entityId`, newest first, each `patch` rendered against the folded state
immediately before it. **Group feed**: all ops, same renderer. Both are read
only: there is no restore-to-version, and undoing something is editing it
([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)).

The sentence for a revision lives in `apps/web/lib/history-copy.ts` — it is the
app's vocabulary for the log, and it names the member a membership revision is
*about* rather than the actor, or adding three people reads as one person
joining three times.

## Gotchas

- **Never garbage-collect ops.** They are the history feature. If the log ever
  got genuinely large the answer is snapshotting, and that's a new ADR.
- `createdAt` is display-only. Sort by it and conflicts start resolving
  differently on different phones.
- **A screen waiting on sync must watch the DB, not check once.** `/join` used
  to run `syncGroup()` and check the local table once with `useState`; a
  brand-new device whose first attempt failed dead-ended on "couldn't find that
  group" while `StartSync`'s background loop was already retrying successfully.
  It now watches `groups` with `useLiveQuery` and moves on the moment the group
  lands, from any attempt. The secret is saved up front either way.
- **`acceptOps` reserves seq numbers with `UPDATE ... RETURNING`**, not inside
  an explicit transaction, so two concurrent pushes to the same group could in
  theory race. Deliberately not hardened: a few phones, human-paced. If it ever
  bites, wrap reserve-and-insert in a D1 transaction.
