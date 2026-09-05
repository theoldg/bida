# Invariants and how they are held

*For: anyone adding a check that reads other entities, or touching member
identity or the merge rule.*

This is the open work. Everything else shipped; what is left is the class of
defect below, and the direction the owner has settled on for closing it.

**Why this class and not another.** Every other bug costs a screen. These cost
the ledger. Two phones that fold the same log into different balances break the
one promise the app makes, and they break it quietly — nobody asked for the
money to move, so nobody is looking when it does. The two defects found so far
both reached a real group: one left a departed member holding a debt with no way
to settle it, the other priced one person's dinner twice.

## The rule

The op log guarantees **convergence** — every device folds to the same state
([sync.md](sync.md)). It does not guarantee **validity**: that the state
everyone agrees on is one the app considers legal. The two come apart wherever
an invariant spans more than one entity, because those are checked in the UI,
at write time, against one device's snapshot — a read-modify-write over
distributed state with no coordination.

> **A precondition that quantifies over entities you did not write is not a
> guard, it is a wish.**

A check before appending constrains one replica's view of the log. It cannot
constrain the union of two. So an invariant survives a merge only if it is held
one of three ways:

1. **Unreachable** — the state cannot be written down. Natural keys, derivation
   at read, atomic entities. Always prefer this: nothing to run, nothing to test.
2. **A healer** — a pure detector naming the *state* (not the event behind it),
   and a repair that folds it away, declared together in `core/invariants.ts`
   so neither can ship without the other. Its contract is below.
3. **Courtesy** — a UI refusal, which is a kindness to whoever is holding the
   phone and **not** a correctness mechanism. Every guard in the app is this,
   whether or not it was written believing so.

Reads of other entities are safe when their failure mode is **convergence**,
not **refusal**: missing a match yields a duplicate a healer folds away, while
missing a refusal yields a state with no trace to repair from.

### What a healer must be

1. **Detection is a pure function on state**, in core, named for the state —
   whichever race produced it gets the same repair.
2. **The repair is ordinary ops.** No new op kind, no mutation, nothing the
   fold has to learn.
3. **Idempotent**: the healed state fails its own detector, so a second run,
   screen or device writes nothing.
4. **Deterministic**, or run by exactly one device — two phones noticing at
   once must not write two different repairs.
5. **History names the cause, not the actor** (`copy.said.readded`), because
   money moved without anyone asking.

## What holds each invariant

| Invariant | Held by | Status |
|---|---|---|
| Money is an integer, minor units, positive | types, `core/money.ts` | held |
| A split resolves to exactly `baseAmountMinor` | `core/split.ts` | held |
| Balances sum to zero | derived on read, `touch()` | held |
| One rate per currency per group | natural key (the currency code) | held |
| One identity row per device per group | natural key (the node id) | held |
| A live entry names only live members | healer — `liveEntriesNameLiveMembers` | held |
| An entry's derived fields agree with its own (`paidBy` ∈ `payers`) | — | **open** — whole-entity merge |
| A device's claimed member is live | — | **open** — the phone puts them back |
| A group has at least one live member | — | **open** — follows from the above |
| Two live members never share a `nameKey` | — | **open** — name as identity, part built |
| A currency with live entries has a live rate | healer — `liveEntriesHaveLiveRates` | held |

## Decided, not built

Three calls from the owner, 2026-09-05. Only the rename ban has begun; each
removes more than it adds, and together they cut the programme from five
healers to two.

**An entry merges whole, not per field.** The last edit wins the entity —
"the final version is what was seen locally by whoever edited it last". The
concurrency this buys back is worth more than the field-level merge it gives
up: every materialised entity becomes a state a person actually looked at, so
an amount from one phone can no longer sit beside a split from another that
does not sum to it. That state is currently reachable, drops the entry out of
balances behind a warning, and is the one case no rule can repair — nothing can
recover intent from two half-edits. Reverses the merge rule in
[ADR-0002](decisions/0002-append-only-op-log.md).

Two amendments it does not work without:

- **Lifecycle fields stay per-field.** A whole-entity write carries whatever
  `deletedAt` the editor's device believed, so a stale snapshot would undo a
  heal — a rename saved offline re-tombstoning a member a healer just put back.
  Content merges whole; `deletedAt` merges per field. `createdAt` should join
  `IMMUTABLE_FIELDS` at the same time, being documented as write-once and not
  currently protected.
- **History diffs by re-folding**, rather than reading the stored patch. Whole
  entities would otherwise make every revision read as "changed everything" —
  the problem `only()` and the `kind` special case were each written to fix.
  Folding to the op before and the op after and diffing those is also more
  honest: it shows what the revision changed in the merged timeline, not what
  one device thought it was changing.

Migration is free: `applyPatch` cannot tell a whole patch from a partial one,
so every op already written folds exactly as it does today.

**A member's name is their identity, and neither can be renamed.** The rename
button is already off the member row; `renameMember` survives only to fold the
`name` updates existing groups have written. What is left is the half that pays
for it: `memberId = hash(groupId + nameKey)`, and the same-name check in the UI
dropping to a hint. Two phones adding "Ana" offline then mint the *same id* —
the creates are one entity, the fold merges them, and there is no duplicate to
find. This is the third entity keyed by what it is rather than by `newId()`,
after the rate and the identity claim ([data-model.md](data-model.md#entities)).

It also closes the argument that killed this idea the first time. A natural key
is only safe when the key is immutable — otherwise a rename frees a name whose
id is still occupied, and the next person to type it inherits the balance.
Forbidding rename is what makes the name immutable.

What it costs, both of which are broken today rather than working:

- **Two genuinely different people named Ana.** They now merge silently, with
  no way out. `nameTaken` keeps refusing — it costs nothing and catches every
  case one device can see both halves of — and the field gains the names
  already in the group, so the second Ana has something to act on rather than
  just a no. The refusal is courtesy either way: two offline phones still
  merge, which is what `names.ts` has always claimed the app means.
- **Typos are permanent** once any money names you, since removal is refused
  there. Accepted rather than reintroducing rename.

**A cleared rate comes back the same way a member does.** A live entry — an
expense *or* a transfer — written in a currency whose rate row is tombstoned
lifts that row. The mirror of the member case in every respect: the same race
(clearing is refused while entries spend in it, which needs both facts on one
phone), the same repair (`deletedAt: null`, which is the op `setRate` already
writes), and the same reading of which half gives way. A currency with **no row
at all** is deliberately left alone — the group has never said what it is worth,
there is no number to restore, and `needsRate` and the rate dialog own it.

**Being on a receipt is being involved.** "Who was there" is a person saying
they were at the meal; ending up assigned no line and owing zero is an outcome,
not an absence. `receiptInvolved` and `receiptAssignments` therefore join
`payerList` and `splitParticipants` in `expenseInvolves`, which makes the
removal refuse *and* the healer put them back from a single edit — the whole
point of the guard and its healer being one declaration.

**Legacy groups keep the gap.** Members already written carry `newId()` and
cannot be re-keyed — every entry references them and ops are never rewritten.
So an old "Ana" and a newly added "Ana" still collide in a group that predates
the change. Accepted knowingly: the affected groups are known, and the merge
healer this would otherwise need is the most expensive thing on the list.

**A phone whose member was removed puts them back.** Removal is refused while
anybody is named on a live entry, but that needs both facts on one phone — so
removing Bruno while Bruno's phone is offline leaves him a *ghost*:
`device.meByGroup` still points at him, the claim gate passes, and every entry
naming him is refused with nothing on screen saying why. On sync, a phone whose
claimed member is tombstoned lifts it: *"Bruno came back"*.

Unconditionally — not only where an entry contradicts the removal. **Forgetting
is the exit that makes that safe**: a forgotten group is skipped by the sync
loop (`sync.ts`), so a phone that accepts the removal stops syncing and stays
gone, while a phone still using the ledger keeps its person. A removal the
other side goes on refusing is not a removal, it is two people disagreeing, and
a shared ledger is not where that gets settled.

Signing as the subject rather than an actor is what lets this run in
`syncGroup`, where merges actually happen, rather than waiting for somebody to
open a screen with a claimed identity. It also makes the empty group
impossible rather than merely rare: every claimed member's phone restores them
on its next sync.

## Open questions

- **What does the removal sheet promise now?** If a claimed phone always
  restores its person, removal only sticks against somebody who has forgotten
  the group or lost the phone. That is the intended behaviour, but the sheet
  still reads as though removing is final, and it is the one screen that would
  then be lying.
- **Does the log stay small enough?** Whole-entity ops repeat every field on
  every edit, and a receipt-scanned expense is not small, and ops are never
  collected ([sync.md](sync.md#gotchas)). It ships whole and gets measured on a
  realistic group afterwards — a number settles this, not an argument.
- **Should healing move onto the sync path?** It runs from `/g` today, which
  needs somebody to open a screen with a claimed identity. `syncGroup` is where
  merges actually happen, and the come-back healer above has to run there —
  but a repair triggers the push that triggers the repair, so whatever runs it
  there has to be shown to reach a fixed point under a loop it cannot see.

## Enforcement

Docs are how a cold agent learns this; they enforce nothing. `data-model.md`
described the removal guard correctly and the guard still shipped without a
healer. And the server cannot help — it stores ops and assigns `seq`, it never
folds ([ADR-0002](decisions/0002-append-only-op-log.md)) — so enforcement is
client-side at authoring time or nowhere. Four layers, weakest first:

1. **`rules-check.mjs`** refuses a call to `memberInvolved` anywhere in
   `apps/web`. A screen takes its verdict from `data.guard`, never from a bare
   predicate. It cannot see the difference between a read that converges and
   one that refuses, which is why it is the weakest layer.
2. **The type.** `Invariant<V>` requires `repair`; `wouldViolate` — the UI's
   refusal — is optional and declared beside it. A guard therefore *implies* a
   healer, because there is nowhere else for a screen to get an answer. The
   failure this class keeps producing becomes a compile error.
3. **`invariants.test.ts`** holds every registered entry to the five rules
   above: detects the state, repairs it in one pass, is idempotent, writes the
   same repair on every permutation, and reaches a fixed point. Its first test
   refuses a registry entry with no violating scenario — so an invariant whose
   healer has never actually run cannot be added.
4. **`integrity.test.ts`** asserts the properties directly, over hostile
   permutations no single device would write, naming no healer at all. It is
   the only layer with a chance against the invariant nobody declared: deleting
   an entry from the registry turns it red.

**Existence is not liveness**, and conflating them writes a healer that
destroys history. Every reference is checked for *existence* — always true by
construction, since a delete tombstones and never removes a row. Only
references that move money — an entry's members, an entry's currency — are
checked for *liveness*. An `identity` claim pointing at a removed member is the
case that forces the distinction: it is a true historical fact, and every op
that device stamped is attributed through it, so a healer that repointed or
dropped it would erase the attribution to satisfy a property nobody wanted.

## Gotchas

- **A guard and its healer must be one declaration.** They used to be two
  functions that happened to agree — `memberInvolved` refusing, `strandedMembers`
  detecting — and free to drift. Every defect in this file was a guard whose
  healer was never written: the check looked like enforcement, so nobody asked
  what happened when it lost. `Invariant` now requires the repair and makes the
  refusal the optional half, which is the inversion that matters.
- **Healers must not fight.** One that tombstones and one that lifts, pointed
  at the same row, is an op loop that syncs. Whatever runs them has to reach a
  fixed point and be tested for it, especially once healing moves onto the sync
  path where a repair triggers the push that triggers the repair.
- **The name-as-identity decision earns an ADR when it is built** — it is
  expensive to reverse, and a future session will argue with it. Not before:
  an ADR records a decision the code already obeys
  ([decisions/](decisions/README.md)).
