# 0006 — Per-field last-write-wins, not a CRDT library

**Status:** Accepted · 2026-08-27

## Context

[0002](0002-append-only-op-log.md) requires merging concurrent offline edits from
several phones. The well-trodden answer is a CRDT library — Yjs, Automerge,
Loro — which guarantees convergence without a coordinator.

## Decision

Roll per-field last-write-wins over the op log, ordered by hybrid logical clock.
No CRDT library.

- Ops carry only changed fields, so concurrent edits to *different* fields of the
  same expense both survive with no conflict at all.
- Concurrent edits to the *same* field resolve by highest HLC. Both ops stay in
  the log, so history can show the edit that lost and who made it.
- HLC = `<physical-ms>:<counter>:<nodeId>`, zero-padded for lexicographic
  ordering, so a phone with a wrong wall clock can't silently win every conflict.

## Consequences

- A few hundred lines we fully understand, versus a dependency whose merge
  semantics we'd have to reason about anyway.
- No CRDT metadata growth, no library-versioned document format to migrate, no
  binary blob we can't inspect in the D1 console.
- The fold stays a pure function over plain JSON — testable with property tests,
  and importable into the Worker later if the server ever needs to fold.
- **We do not get collaborative text editing.** Two people typing in the same
  description field concurrently means one of them loses their text. For an
  expense splitter this is fine; the losing text is visible in history.
- Sets edited concurrently (the participant list) are last-write-wins as a whole,
  not element-wise merged. Adding someone while another person removes someone
  else means one change is lost. Acceptable at this scale, visible in history,
  and the case that would justify revisiting.

## Rejected

- **Yjs / Automerge / Loro** — genuinely better for text and lists, and the right
  answer for a document editor. Here they'd add a dependency, a binary format,
  and metadata overhead to solve a conflict rate of roughly "twice a year, on a
  trip".
- **Server-side conflict resolution** — needs the server to fold, which
  [0001](0001-cloudflare-workers-d1-r2.md)'s 10 ms CPU limit and
  [0002](0002-append-only-op-log.md)'s stupid-server principle both push against.

## Revisit if

Element-wise set merging or concurrent text editing turns out to matter in real
use. The op log is the right substrate for either — a CRDT could be introduced
for one field type without changing the protocol.
