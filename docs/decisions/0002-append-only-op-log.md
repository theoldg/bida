# 0002 — An append-only op log, merged per-field by last-write-wins

**Status:** Accepted · 2026-08-27

**Context.** Three requirements landed together: fully offline **including
writes**, **sync** between several phones, and a complete **version history**.
Built separately those are three subsystems, and the interactions between them
are where the bugs would live.

## Decision

**Nothing is mutated in place.** Every change is an operation appended to a
per-group log, and current state is a deterministic fold over it. The log is the
sync wire format, the offline write buffer and the version history — one
mechanism, three features. The client folds; the server appends, assigns a
sequence number and hands ops back. It does not fold.

**Merging is per-field last-write-wins over that log, ordered by hybrid logical
clock — no CRDT library.** Ops carry only changed fields, so concurrent edits to
*different* fields both survive; same-field edits resolve by highest HLC, and
both ops stay in the log so history can show the edit that lost. HLC is
`<physical-ms>-<counter>-<nodeId>`, zero-padded, so a phone with a wrong wall
clock can't silently win every conflict.

## Consequences

- Offline writes are free; nothing is lost if network, tab or battery dies.
  Sync is two endpoints and an integer cursor.
- History costs **zero additional storage** and cannot drift from reality,
  because it *is* reality.
- Reads require a fold — mitigated by materialising entities into Dexie tables
  and folding incrementally. Those tables are a rebuildable cache.
- **No collaborative text editing**, and a set edited concurrently (the
  participant list) is LWW as a whole rather than merged element-wise. Someone
  loses a change; it is visible in history.
- Ops are never deleted. At our scale that's irrelevant; if it ever isn't, the
  answer is snapshotting, and that's a new ADR.
- One in-place update silently breaks offline, sync and history at once.

## Rejected

- **CRUD + a separate audit table** — the audit table drifts from the data, and
  offline conflict resolution has to be invented from scratch anyway.
- **Server-authoritative with optimistic UI** — can't do offline writes across a
  restart, and needs a rollback path we'd get wrong.
- **Domain events** (`ExpenseSplitChanged`) — more expressive, much more code.
  Field-level patches make diffing trivial.
- **Yjs / Automerge / Loro** — right for a document editor. Here: a dependency,
  a binary format and metadata overhead to solve a conflict rate of roughly
  "twice a year, on a trip".
- **Server-side conflict resolution** — needs the server to fold, against both
  [0001](0001-cloudflare-workers-d1-r2.md)'s CPU limit and the stupid-server
  principle.

**Revisit if** element-wise set merging or concurrent text editing matters. A
CRDT could be introduced for one field type without changing the protocol.
