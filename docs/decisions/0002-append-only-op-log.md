# 0002 — Local-first, append-only operation log

**Status:** Accepted · 2026-08-27

## Context

Three requirements landed together: the app must work **fully offline including
writes**, it must **sync** between several people's phones, and it must keep a
**complete version history** with restore.

Implemented separately, those are three subsystems, and the interactions between
them (what does history show when an offline edit loses a conflict?) are where
the bugs would live.

## Decision

Nothing is ever mutated in place. Every change is an **operation** appended to a
per-group log. Current state is a deterministic fold over that log. The log is
the sync wire format, the offline write buffer, and the version history — one
mechanism, three features.

The client holds the log in IndexedDB and folds locally. The server appends,
assigns a sequence number, and hands ops back. It does not fold.

## Consequences

- Offline writes are free: append locally, push later. Nothing is lost if the
  network, tab, or battery dies.
- Sync is two endpoints and an integer cursor.
- Version history costs **zero additional storage** and cannot drift from
  reality, because it *is* reality.
- Restore is an ordinary forward operation; history is never rewritten.
- Reads require a fold. Mitigated by materialising entities into Dexie tables
  and folding incrementally; the materialised tables are a rebuildable cache.
- Ops are never deleted. At our scale this is irrelevant; if it ever isn't, the
  answer is snapshotting, and that is a new ADR.
- Every developer must internalise the rule. A single in-place update silently
  breaks offline, sync, and history at once.

## Rejected

- **CRUD + a separate audit table** — the audit table drifts from the data, and
  offline conflict resolution has to be invented from scratch anyway.
- **Server-authoritative with optimistic UI** — can't do offline writes across a
  restart, and needs a rollback path we'd get wrong.
- **Event sourcing with domain events** (`ExpenseSplitChanged`) — more expressive
  and much more code. Field-level patches are enough for this domain and make
  diffing trivial.
