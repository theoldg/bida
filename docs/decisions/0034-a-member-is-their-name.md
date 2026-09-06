# 0034 — A member is their name, and a name cannot be changed

**Status:** Accepted · 2026-09-06

**Context.** A member is only ever *shown* as the name somebody typed. The
ledger, the split editor, the payer chips and the balances all carry a bare
name and nothing else, so two members called "Ana" are not a duplicate row to
tidy up later — they are two people nothing on screen tells apart, one of them
quietly holding half the bill. `nameTaken` refused the second one at the field
that would create it, and, like every guard in the app, it reads one replica
and cannot constrain the union of two ([invariants.md](../invariants.md)). Two
phones adding Ana while offline merged into a group with two of her, and there
was no repair: nothing in the log says which of the two anybody meant.

## Decision

**`memberId = hash(groupId + nameKey(name))`** — `core/names.ts`. The same name
typed on two phones is the same entity, so the creates merge in the fold and
there is no duplicate to find. The colour seed is derived from the same key, so
the two creates are byte-identical and it does not matter which one wins.

**Rename is gone.** A natural key is only safe when the key is immutable:
otherwise a rename frees a name whose id is still occupied, and the next person
to type it inherits the balance. The rename button is off the member row and
`renameMember` survives only to fold the `name` updates existing groups have
already written.

Members are the third entity keyed by what they are rather than by `newId()`,
after the rate (its currency code) and the identity claim (its node id) —
[data-model.md](../data-model.md#entities).

## Consequences

- **Two genuinely different people named Ana merge**, silently and with no way
  out. `nameTaken` keeps refusing where one phone can see both halves, and now
  says what to do about it rather than only saying no. Distinguishing them is
  the person's job, at the field, in the moment.
- **A typo is permanent** once any money names that member, since removal is
  refused there too.
- **Re-adding somebody who was removed returns the person** — same id, so the
  balance and the history come back with them, rather than a stranger wearing
  their name.
- **Legacy groups keep the gap.** Members written before this carry `newId()`
  and cannot be re-keyed: every entry references them and ops are never
  rewritten. An old "Ana" and a newly added "Ana" still collide there.

## Rejected

**Keep `newId()` and heal duplicates after the merge.** The healer would have
to pick a survivor and rewrite every reference to the loser — payers, splits,
transfers, receipt assignments — which is a rewrite of history in all but name
([0031](0031-history-reads-it-does-not-rewind-it.md)), and it guesses at the one
fact the log does not hold: whether the two Anas were one person.

**Keep rename and accept duplicates.** This is what shipped, and it is the
defect: the app has no id on screen to disambiguate with, so "accept" means
leaving two people who cannot be told apart in a ledger about who owes whom.

**A cryptographic hash.** `crypto.subtle.digest` is async, and every caller here
is a pure synchronous function in `packages/core`. Nothing is authenticated by
this id — it only has to avoid colliding across the handful of names one group
holds, and the names are in the log in plaintext anyway — so FNV-1a, hand-rolled
rather than added as a dependency, is the right size of tool.
