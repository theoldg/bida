# 0002 — An append-only op log, merged by last-write-wins

**Status:** Accepted · 2026-08-27, amended 2026-09-05

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

**Merging is last-write-wins over that log, ordered by hybrid logical clock —
no CRDT library.** The loser's op stays in the log either way, so history can
show the edit that lost. HLC is `<physical-ms>-<counter>-<nodeId>`, zero-padded,
so a phone with a wrong wall clock can't silently win every conflict.

**An entry's content merges whole; everything else merges per field**
(amended 2026-09-05). A `member`, `rate`, `identity` or `group` op carries only
the fields it changed, so concurrent edits to different fields of one of those
both survive. An **expense or transfer** op carries the entity as the saver saw
it, and the highest HLC wins all of it.

Per-field was the original rule everywhere, and for entries it was wrong. It
bought concurrency nobody was using — two people editing one expense at the same
moment, on a trip — and paid for it with the one state no rule can repair: an
amount from one phone beside a split from another that does not sum to it. That
entry drops out of balances behind a warning, and nothing can recover what
either person meant from two half-edits. Whole entities make every materialised
entry a version somebody actually looked at.

Two fields stay out of the whole, or the amendment breaks the repairs that
depend on it:

- **`deletedAt` merges per field.** A whole write carries whatever lifecycle
  the editing device believed, so a save made offline would undo a tombstone —
  or re-apply one a healer had just lifted ([invariants](../invariants.md)).
- **`createdAt` is write-once**, enforced in the fold, because every whole write
  now carries one and list order breaks ties on it.

**History diffs by re-folding.** A revision is the difference between the fold
before an op and the fold after it, never a reading of the patch's keys —
otherwise every edit would read as "changed everything". It is also the more
honest account: what the revision changed in the merged timeline, rather than
what one device believed it was changing.

Migration was free: `applyPatch` cannot tell a whole patch from a partial one,
so every op already written folds exactly as it did.

## Consequences

- Offline writes are free; nothing is lost if network, tab or battery dies.
  Sync is two endpoints and an integer cursor.
- History costs **zero additional storage** and cannot drift from reality,
  because it *is* reality.
- Reads require a fold — mitigated by materialising entities into Dexie tables
  and folding incrementally. Those tables are a rebuildable cache.
- **No collaborative text editing.** Two people editing one entry at once means
  someone loses their change entirely, not just the field they clashed on. It
  is visible in history, and what it buys is that the survivor is coherent.
- **Entry ops repeat every field**, so the log grows faster than it did. Ops are
  never collected, so this wants measuring on a real group rather than arguing
  about — [invariants.md](../invariants.md#open-questions).
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

**Revisit if** element-wise set merging or concurrent text editing matters, or
if measured log growth makes whole entries too expensive. A CRDT could be
introduced for one field type without changing the protocol.
