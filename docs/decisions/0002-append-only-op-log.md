# 0002 — An append-only op log, merged per-field by last-write-wins

**Status:** Accepted · 2026-08-27

**Context.** Three requirements landed together: fully offline **including
writes**, **sync** between several phones, and a complete **version history**.
Built separately those are three subsystems, and the interactions between them
are where the bugs would live. Merging concurrent offline edits is the hard
part, and the well-trodden answer is a CRDT library — Yjs, Automerge, Loro.

## Decision

**Nothing is mutated in place.** Every change is an operation appended to a
per-group log, and current state is a deterministic fold over it. The log is the
sync wire format, the offline write buffer and the version history — one
mechanism, three features. The client folds; the server appends, assigns a
sequence number and hands ops back. It does not fold.

**Merging is per-field last-write-wins over that log, ordered by hybrid logical
clock — no CRDT library.** Ops carry only changed fields, so concurrent edits to
*different* fields both survive with no conflict; same-field edits resolve by
highest HLC, and both ops stay in the log so history can show the edit that
lost. HLC is `<physical-ms>:<counter>:<nodeId>`, zero-padded, so a phone with a
wrong wall clock can't silently win every conflict.

## Consequences

- Offline writes are free; nothing is lost if network, tab or battery dies.
- Sync is two endpoints and an integer cursor.
- History costs **zero additional storage** and cannot drift from reality,
  because it *is* reality.
- Reads require a fold — mitigated by materialising entities into Dexie tables
  and folding incrementally. Those tables are a rebuildable cache.
- The fold stays a pure function over plain JSON: property-testable, and
  importable into the Worker if the server ever needs it.
- **No collaborative text editing.** Two people typing in one description
  concurrently means one loses their text — fine here, and visible in history.
- Sets edited concurrently (the participant list) are LWW as a whole, not merged
  element-wise. Adding someone while another person removes someone else loses
  one change.
- Ops are never deleted. At our scale that's irrelevant; if it ever isn't, the
  answer is snapshotting, and that's a new ADR.
- Every developer must internalise the rule: one in-place update silently breaks
  offline, sync and history at once.

## Rejected

- **CRUD + a separate audit table** — the audit table drifts from the data, and
  offline conflict resolution has to be invented from scratch anyway.
- **Server-authoritative with optimistic UI** — can't do offline writes across a
  restart, and needs a rollback path we'd get wrong.
- **Domain events** (`ExpenseSplitChanged`) — more expressive, much more code.
  Field-level patches are enough here and make diffing trivial.
- **Yjs / Automerge / Loro** — right for a document editor. Here: a dependency,
  a binary format and metadata overhead to solve a conflict rate of roughly
  "twice a year, on a trip".
- **Server-side conflict resolution** — needs the server to fold, which both
  [0001](0001-cloudflare-workers-d1-r2.md)'s 10 ms CPU limit and this ADR's
  stupid-server principle push against.

**Revisit if** element-wise set merging or concurrent text editing matters. A
CRDT could be introduced for one field type without changing the protocol.
