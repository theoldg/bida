# 0031 — History is read, not rewound: no restore-to-version

**Status:** Accepted · 2026-08-30

**Context.** The owner: *"remove the option to rewind changes. It's too
complicated, buggy, and difficult to justify in the UI."* Restore was cheap to
build on an append-only log ([0002](0002-append-only-op-log.md)) and expensive
to explain: a field-level patch is not what anyone means by "put it back", it
carried bookkeeping fields nobody typed (`amountMinor`, `rateToBase` and
`baseAmountMinor` are one number three times), it could restore an entry to a
state referencing members who had since left, and on a shared log it let one
phone silently undo somebody else's edit two revisions deep.

## Decision

- **The history is a record, not a control.** `/g/history` shows revisions,
  their diffs and what they were about; the only thing it does is link to the
  entry.
- **Undo is editing.** Every value a revision names is on screen in the entry
  form — a wrong amount is fixed by typing the right one, which is also what the
  log then says happened.
- **`restore` stays a valid `OpKind` and still folds like an update.** Groups in
  production hold restore ops already; refusing to fold them would rewrite the
  past to remove a feature. Nothing emits one any more.
- **`buildRestorePatch`, `foldEntityAt`, `entityOps`, `/g/restore` and
  `fieldLabel` / `fieldValue` are deleted.** They existed for this screen alone.

## Consequences

- Deleting an entry no longer promises a way back; the delete dialog says what
  is actually true — the balance moves now, and the history keeps the record.
- A per-field "as it was" reading of an old revision is gone. The diff on each
  revision still says what changed, which is what the feed was read for.
- If restore ever returns, it returns as an entry-level "put this whole thing
  back" with an entry-shaped confirmation, not a patch viewer.

## Rejected

- **Keep it, restricted to the entry's own author** — the complexity was never
  in who may press it; it was in what pressing it means.
- **Keep it, hidden behind a long press** — a feature nobody can find is still a
  feature every screen has to stay compatible with.
