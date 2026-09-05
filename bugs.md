# Bugs

*A punch list from a UX pass over the whole app, 2026-09-04. Triaged with the
owner; items they judged working-as-intended are already gone from it.*

Ordered by what it costs to leave alone. Each item says where it is and what to
do, not just what is wrong. Delete an item when it is done — this file is a
queue, not a record.

---

## 1. Crashes the screen

### 1.1 One throw anywhere is a white screen with nothing to press

There is no `error.tsx` or `global-error.tsx` anywhere under `apps/web/app/`,
so any throw during render unmounts the tree, and the service worker serves the
shell cache-first. The two throws that got here this way are fixed — a scanned
currency symbol and an out-of-range conversion, both in the entry form — but
the class isn't: `formatMinor` and `parseMinor` throw by design and are called
all over every screen.

**Do:** a route-level `error.tsx` and a `global-error.tsx` that say something
and offer the way out (reload, and back to the group list). Needs a copy
decision, so it is here rather than done.

---

## 5. Sync and multi-device

### 5.2 Two members with one name should be mergeable

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

### 5.3 Anyone who learns a group id before its creator syncs can steal it

`ensureGroup` registers a group id on first push and stores `sha256(secret)`
from *that* request, so the first request to name an unregistered id owns it.
`lib/group-link.ts` states the opposite as the reason an id may travel in the
open — it "confers nothing without the secret" — and that is the part that
isn't true.

Narrow, and worth being honest about how narrow: it needs an id that leaked
without its secret (the id is in the address bar on every screen; the secret
stays in the fragment) *and* a creator who has not pushed yet, which online is
seconds. Nothing is exposed either way — the thief registers an empty group.
What it costs is the owner's sync, permanently, while `copy.rejected` tells
them to open the invite link again, which cannot help: there is no rotation, so
a fresh link is byte-identical.

**Do:** key the id to the secret rather than to who asked first — derive it
(`groupId = truncate(sha256(secret))`) and check the pair at registration, so
an id known on its own is not a claim.

---

## 6. Smaller, all real

- **A form held open across a peer's edit still loses that edit.** The command
  layer diffs the posted form against the entity *as of save*, so a whole-form
  save no longer clobbers a field it never touched. But a form opened before
  the peer's op arrived holds their old value and posts it as a deliberate
  change, which is per-field LWW working correctly on a lie. Either re-read the
  entity into the open form when sync brings a change, or say so.
- **A departed member's balance can never be cleared.** Removal is refused
  while a member is named on anything, so this needs a race — a peer adding an
  entry offline while somebody removes them — but the state is reachable and
  the app already shows it: the balances tab lists them, marked as departed, and
  offers the settle-up row that squares them off. Following that row opens a
  transfer whose other side is a person no picker offers, and Save is held. The
  form now names them instead of showing a grey button over an empty slot, but
  the debt still has no way out. Either the transfer sides accept a removed
  member (only they can, and only where a balance says so), or the settle-up
  row stops offering what the form refuses — a product call, which is why it is
  here.
- **History stamps are wall clock while ordering is HLC.**
  `stamp(rev.op.createdAt)` sorted by `compareHlc`, so on any skewed device the
  timeline shows times out of order. Less alarming once 5.1 lands, still worth
  a note in the UI or a switch to something monotonic.

---

## Needs more thought before it becomes a task

**Discount and zero lines are counted two different ways.**
`receiptTotalMinor` adds every parseable line, negatives included;
`weightsFromItems` skips anything `<= 0`. So a discount shrinks the bill's
total but takes no part in the ratios — which means it is spread across
everybody in proportion to what they ordered, rather than landing on whoever
the discount was actually for.

That may well be the right answer: a "-5.00 loyalty card" on a restaurant bill
probably *should* be shared. But a voucher against one person's dish should
not, and today the grid gives no way to say which. So `checkScan` refuses a
receipt with a credit line outright — nothing is mispriced, and nothing is
importable either. Deciding what a negative line means on the grid — including
whether it is assignable to people, like any other line — is what unblocks it.
