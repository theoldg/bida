# 0006 — Per-field last-write-wins, not a CRDT library

**Status:** Accepted · 2026-08-27

**Context.** [0002](0002-append-only-op-log.md) requires merging concurrent
offline edits from several phones. The well-trodden answer is a CRDT library —
Yjs, Automerge, Loro.

**Decision.** Roll per-field last-write-wins over the op log, ordered by hybrid
logical clock. No CRDT library. Ops carry only changed fields, so concurrent
edits to *different* fields both survive with no conflict; same-field edits
resolve by highest HLC, with both ops staying in the log so history can show the
edit that lost. HLC is `<physical-ms>:<counter>:<nodeId>`, zero-padded, so a
phone with a wrong wall clock can't silently win every conflict.

## Consequences

- A few hundred lines we fully understand, versus a dependency whose merge
  semantics we'd have to reason about anyway.
- No CRDT metadata growth, no versioned document format to migrate, no binary
  blob we can't inspect in the D1 console.
- The fold stays a pure function over plain JSON — property-testable, and
  importable into the Worker if the server ever needs to fold.
- **No collaborative text editing.** Two people typing in the same description
  concurrently means one loses their text — fine here, and visible in history.
- Sets edited concurrently (the participant list) are LWW as a whole, not merged
  element-wise. Adding someone while another person removes someone else loses
  one change. Acceptable at this scale, and the case that would justify
  revisiting.

## Rejected

- **Yjs / Automerge / Loro** — better for text and lists, and right for a
  document editor. Here: a dependency, a binary format and metadata overhead to
  solve a conflict rate of roughly "twice a year, on a trip".
- **Server-side conflict resolution** — needs the server to fold, which both
  [0001](0001-cloudflare-workers-d1-r2.md)'s 10 ms CPU limit and 0002's
  stupid-server principle push against.

**Revisit if** element-wise set merging or concurrent text editing turns out to
matter. A CRDT could be introduced for one field type without changing the
protocol.
