# Sync, offline, and version history

*For: anyone touching the op log, the sync engine, or history UI.*

These are one subject. The log that syncs is the log that renders history.

## The operation

```ts
type Op = {
  id: string          // client-generated UUID; the idempotency key
  groupId: string
  entity: 'group' | 'member' | 'expense' | 'settlement' | 'attachment'
  entityId: string
  kind: 'create' | 'update' | 'delete' | 'restore'
  patch: Record<string, unknown>   // changed fields ONLY, never the whole entity
  hlc: string         // hybrid logical clock — see below
  actor: string       // memberId
  note?: string       // optional human reason, surfaced in history
  createdAt: number   // wall clock, for display only — never for ordering
  seq?: number        // assigned by the server on accept; absent = unsynced
}
```

`patch` carrying **only changed fields** is what makes concurrent edits to
different fields of the same expense merge cleanly instead of clobbering.

## Ordering: hybrid logical clocks

Wall clocks on phones are wrong, sometimes by minutes. Ordering by `createdAt`
would let a phone with a slow clock silently lose every conflict.

HLC (`packages/core/hlc.ts`) is `<physical-ms>:<counter>:<nodeId>`, zero-padded
so lexicographic string comparison equals causal-ish ordering:

- On send: `physical = max(now, lastPhysical)`; if equal, increment `counter`,
  else reset it to 0.
- On receive: `physical = max(now, lastPhysical, remotePhysical)`, counter
  advanced accordingly.
- `nodeId` is a random per-device string, breaking ties deterministically.

**Ordering is by HLC, never by `seq` and never by `createdAt`.** `seq` orders
*arrival at the server*, which is a different thing and is only used to ask
"what have I not pulled yet".

## Folding

```
fold(ops) → entities
```

Sort by `hlc` ascending, then per entity apply in order:

- `create` — initialise the entity.
- `update` — assign each field in `patch`. **Per field, last write wins by HLC.**
- `delete` — set `deletedAt`. Never remove the row; other ops may still reference it.
- `restore` — resolve the target revision by folding that entity's ops up to a
  given HLC, then emit the resulting field values as this op's `patch`. A restore
  is a normal forward-moving update; it does not rewind the log.

The fold is pure and total: any subset of ops produces *some* valid state.
An `update` arriving before its `create` produces a partial entity that completes
when the `create` lands. Do not throw on out-of-order ops.

See [ADR-0006](decisions/0006-lww-not-crdt.md) for why per-field LWW and not a
CRDT library.

## The protocol

Two endpoints. That's the whole thing. **Implemented** — `apps/api/src/index.ts`
(routes), `apps/api/src/store.ts` (D1 access), `apps/api/src/auth.ts` (the
bearer-secret check).

**`POST /api/groups/:id/ops`**
```jsonc
// →
{ "ops": [ /* unsynced Op[], without seq */ ], "since": 412 }
// ←
{ "assigned": { "<opId>": 413, ... },   // seq per accepted op
  "ops": [ /* ops with seq > 412 that this client hasn't seen */ ],
  "latestSeq": 419 }
```
Accepting is idempotent on `Op.id` — a retried push after a dropped response is
a no-op, which is what makes retry safe on a flaky connection.

There is no separate "create group" endpoint. A group's **first** push
registers it in D1 — the server stores `sha256(secret)` from that first
request's bearer token and every later request (push or pull) is checked
against it. A `GET` on a group that has never been pushed to returns 404: the
creating device has to sync at least once before a `/join` link is pullable
anywhere else.

**`GET /api/groups/:id/ops?since=N`** — the same pull, without a push.

Both authenticate with the group secret as a bearer token
(`Authorization: Bearer <secret>`); see
[ADR-0003](decisions/0003-link-only-access.md).

## The sync engine

Lives in `apps/web/lib/db/sync.ts`. **Implemented.** A single-flight loop
triggered by:

- a local write (debounced ~1 s),
- `visibilitychange` → visible,
- `online`,
- a slow interval (60 s) while the app is foregrounded.

Backoff on failure: 2 s, 4 s, 8 s, capped at 60 s, reset on success. Never
block the UI on it. Never let two runs overlap.

**Attachments sync separately** and on a stricter policy: default to Wi-Fi only
(`navigator.connection.type` where available, plus a manual "upload now"). An
expense is fully synced and correct with its photos still queued — the op
references attachment ids that resolve to local blobs until upload completes.

## Conflicts

Two people edit the same expense while one is offline:

- **Different fields** (she changes the amount, he changes who's involved) —
  both survive. No conflict at all.
- **Same field** — highest HLC wins the materialised value. **Both ops remain in
  the log**, so the history screen shows the losing edit and who made it. The UI
  marks it: *"This change to the amount was later overwritten by Marie's
  edit."* — `overwriteNotes()` in `apps/web/app/g/history/page.tsx`, driven by
  `FieldChange.supersededByOpId` from `packages/core/history.ts`.

We never present a conflict-resolution dialog. For an expense splitter that
would be worse than being briefly wrong — the group can see the history and fix
it in one tap.

## History UI

Falls straight out of the log with no extra storage:

- **Per expense** — `ops` filtered by `entityId`, newest first. Render each op's
  `patch` against the folded state immediately before it to produce the
  before/after diff. Show `actor`, `createdAt`, and `note`.
- **Group activity feed** — all ops for the group, newest first, same renderer.
- **Restore** — emit a `restore` op as described above.

The diff renderer needs a per-field formatter (money, member lists, dates); keep
it in one place so history and the expense form agree on wording.

## Gotchas

*Add to this list every time one bites you.*

- Never garbage-collect ops. They are the history feature. If the log ever gets
  genuinely large (it won't, at this scale) the answer is snapshotting, not
  deletion — and that's a new ADR.
- `createdAt` is display-only. Every time someone sorts by it, conflicts start
  resolving differently on different phones.
- **`/join` now actually pulls.** It saves the secret, calls `syncGroup()` once
  immediately, then checks whether the group landed locally — see
  `apps/web/app/join/page.tsx`. If the creating device hasn't synced yet
  (no ops ever pushed, or currently offline), the join fails honestly rather
  than pretending; the invite is saved either way, so re-opening the same link
  later works once the creator's device has synced.
- **`acceptOps` in `apps/api/src/store.ts` reserves seq numbers with an
  `UPDATE ... RETURNING`**, not inside an explicit multi-statement
  transaction — two concurrent pushes to the *same* group could in theory
  race that read-modify-write. Deliberately not hardened further: this app's
  realistic write rate is a few phones, human-paced, in one group at a time.
  If it ever bites, the fix is wrapping the reserve-and-insert in a proper D1
  transaction, not a bigger rewrite.
