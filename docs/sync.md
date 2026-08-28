# Sync, offline, and version history

*For: anyone touching the op log, the sync engine, or history UI.* These are one
subject: the log that syncs is the log that renders history.

## The operation

```ts
type Op = {
  id: string        // client UUID; the idempotency key
  groupId: string
  entity: 'group'|'member'|'expense'|'settlement'|'attachment'|'identity'
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

## Ordering: hybrid logical clocks

Phone wall clocks are wrong, sometimes by minutes; ordering by `createdAt` lets
a slow clock silently lose every conflict. HLC (`core/hlc.ts`) is
`<physical-ms>:<counter>:<nodeId>`, zero-padded so string comparison equals
causal-ish ordering. On send: `physical = max(now, lastPhysical)`, incrementing
`counter` on a tie. On receive: also `max` with the remote physical. `nodeId` is
a random per-device string breaking ties deterministically.

**Order by HLC, never by `seq` and never by `createdAt`.** `seq` orders arrival
at the server and answers only "what have I not pulled yet".

## Folding

Sort by `hlc` ascending, then per entity: `create` initialises; `update` assigns
each field in `patch`, **per-field last write wins by HLC**; `delete` sets
`deletedAt` and never removes the row; `restore` resolves a target revision by
folding that entity up to a given HLC and emits those field values as its own
patch — a normal forward update, not a rewind.

The fold is pure and total: any subset of ops produces *some* valid state. An
`update` arriving before its `create` yields a partial entity that completes
later. Don't throw on out-of-order ops.
[ADR-0006](decisions/0006-lww-not-crdt.md) for why LWW and not a CRDT.

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
block the UI; never let two runs overlap.

**Attachments sync separately**, Wi-Fi-only by default plus a manual "upload
now". An expense is fully synced and correct with its photos still queued — the
op references attachment ids that resolve to local blobs until upload completes.

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
immediately before it. **Group feed**: all ops, same renderer. **Restore**:
emits a `restore` op, reached by a rewind icon at a revision's edge leading to
`/g/restore`, a confirmation screen that names the version and the fields coming
back. Offered only on a revision that isn't the entity's newest, and never for
identity ops.

The sentence for a revision and the per-field formatters live in
`apps/web/lib/history-copy.ts` — one place, so the feed and the restore screen
can't drift apart.

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
