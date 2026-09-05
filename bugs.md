# Bugs

*A punch list from a UX pass over the whole app, 2026-09-04. Triaged with the
owner; items they judged working-as-intended are already gone from it.*

Ordered by what it costs to leave alone. Each item says where it is and what to
do, not just what is wrong. Delete an item when it is done — this file is a
queue, not a record.

---

## Two members with one name should be mergeable

`apps/web/lib/names.ts` argues correctly that two "Ana"s are two people nothing
on screen tells apart — then `nameTaken` only checks the local list.

Reproduced with `pnpm drive`: two phones in one group, both offline, both add
"Ana", both come back. People lists two identical rows. One €120 dinner Ana
paid, split evenly, then prices her twice — balances read `Ana +€90.00` above a
second `Ana -€30.00`, and settle-up instructs "Ana pays Ana €30.00".

Neither existing control repairs it. Rename to a distinct name is allowed and
only makes the two legible — the money stays split across two ids — while
renaming back onto the shared name is refused by `nameTaken`. Removal is worse:
its own sheet says "Their past entries stay as they are", which is the problem.

**Do:** converge automatically rather than offer a repair. One name is already
one person here — that is the whole argument of `names.ts` — so two live
members sharing a `nameKey` is a state to fold away, not a question to ask.
Match on that state, not on the event behind it: an offline add is one route
in, a `/g/claim` add and a concurrent rename are others.

- Pick the winner from the log — earliest create by HLC, id as tiebreak — so
  every device merges the same way with nothing to agree on first, and two
  devices noticing at once write the same merge. Follow `mergedInto` to a root,
  so three collisions chain instead of fight.
- The merge is ops, not a mutation: rewrite the loser's references (`paidBy`,
  `payers` keys, `split` participants, `fromMember`/`toMember`,
  `receiptInvolved`/`receiptAssignments`, `identities`) onto the winner and
  tombstone the loser with a `mergedInto` pointer — which is also how a device
  that claimed the loser follows it, and how a later rename can't un-merge what
  was merged.
- Watch the arithmetic: two ids merging inside one `split` or `payers` map must
  have their amounts **added**, not overwritten, or the entry stops summing to
  its total. This is the part with teeth — cover it in tests before shipping
  it, per the coverage rule in [CLAUDE.md](CLAUDE.md).
- Say it in history, because money moves without anyone asking for it. Name the
  cause, not whichever device did the tidying: "Ana was added twice, offline —
  merged".
