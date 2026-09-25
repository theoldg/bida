# 0031 — History is read, not rewound: no restore-to-version

**Status:** Accepted · 2026-08-30 · a deleted entry comes back whole 2026-09-25

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
- **A deleted entry comes back whole.** Not a revision: the entry as it was
  when deleted, from its own screen, which keeps drawing it with Restore where
  Edit was. It writes `update { deletedAt: null }`, the lift the healers
  already write, so it merges per field and nothing new reaches the fold or
  the wire. The entry wins over a removal made since, as it does after a
  merge: a person or rate it names comes back in the same append
  (`restoreEntryDrafts`), said under the button before the press. An old
  conversion's deleted half is not restorable while its replacement lives —
  that would count the money twice (`liveReplacement`, ADR-0010).
- **`restore` stays a valid `OpKind` and still folds like an update.** Groups in
  production hold restore ops already; refusing to fold them would rewrite the
  past to remove a feature. Nothing emits one: the old ones are field patches,
  so reading the kind as "put back" would misread them.
- **`buildRestorePatch`, `foldEntityAt`, `entityOps`, `/g/restore` and
  `fieldLabel` / `fieldValue` are deleted.** They existed for this screen alone.

## Consequences

- The delete dialog says the entry can be restored from the history. Deleting
  still leaves for the ledger; the way back is the feed's "· deleted" line.
- A per-field "as it was" reading of an old revision is gone. The diff on each
  revision still says what changed, which is what the feed was read for.

## Rejected

- **Keep it, restricted to the entry's own author** — the complexity was never
  in who may press it; it was in what pressing it means.
- **Keep it, hidden behind a long press** — a feature nobody can find is still a
  feature every screen has to stay compatible with.
- **A trash screen, or an undo toast after deleting** — the feed already lists
  what was deleted, and a toast would only cover the entry screen's delete, not
  the ledger's. Nor does deleting stay on the screen to offer Restore: it goes
  back to the ledger (owner, 2026-09-25).
