# 0002 — Local-first, append-only operation log

**Status:** Accepted · 2026-08-27

**Context.** Three requirements landed together: fully offline **including
writes**, **sync** between several phones, and a complete **version history**
with restore. Built separately those are three subsystems, and the interactions
between them (what does history show when an offline edit loses a conflict?) are
where the bugs would live.

**Decision.** Nothing is mutated in place. Every change is an **operation**
appended to a per-group log, and current state is a deterministic fold over it.
The log is the sync wire format, the offline write buffer, and the version
history — one mechanism, three features. The client folds locally; the server
appends, assigns a sequence number and hands ops back. It does not fold.

## Consequences

- Offline writes are free; nothing is lost if network, tab or battery dies.
- Sync is two endpoints and an integer cursor.
- History costs **zero additional storage** and cannot drift from reality,
  because it *is* reality. Restore is an ordinary forward op.
- Reads require a fold — mitigated by materialising entities into Dexie tables
  and folding incrementally. Those tables are a rebuildable cache.
- Ops are never deleted. At our scale that's irrelevant; if it ever isn't, the
  answer is snapshotting, and that's a new ADR.
- Every developer must internalise the rule: one in-place update silently breaks
  offline, sync and history at once.

## Rejected

- **CRUD + a separate audit table** — the audit table drifts from the data, and
  offline conflict resolution has to be invented from scratch anyway.
- **Server-authoritative with optimistic UI** — can't do offline writes across a
  restart, and needs a rollback path we'd get wrong.
- **Event sourcing with domain events** (`ExpenseSplitChanged`) — more
  expressive, much more code. Field-level patches are enough here and make
  diffing trivial.
