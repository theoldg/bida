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
   and a repair that folds it away. `strandedMembers` / `readdStrandedMembers`
   is the worked example; its contract is below.
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
| A live entry names only live members | healer — `strandedMembers` | held |
| An entry's derived fields agree with its own (`paidBy` ∈ `payers`) | — | **open** — whole-entity merge |
| A device's claimed member is live | — | **open** — lift-or-forget |
| A group has at least one live member | — | **open** — follows from the above |
| Two live members never share a `nameKey` | — | **open** — name as identity, part built |
| A currency with live entries has a live rate | — | **open** — needs a healer |

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
  no way out. So the add and join fields must show the names already in the
  group and nudge toward a distinct one — advisory, since a refusal cannot hold
  anyway. Ignore the nudge and you merge, which is what `names.ts` has always
  claimed the app means.
- **Typos are permanent** once any money names you, since removal is refused
  there. Accepted rather than reintroducing rename.

**Legacy groups keep the gap.** Members already written carry `newId()` and
cannot be re-keyed — every entry references them and ops are never rewritten.
So an old "Ana" and a newly added "Ana" still collide in a group that predates
the change. Accepted knowingly: the affected groups are known, and the merge
healer this would otherwise need is the most expensive thing on the list.

**A removal a device contradicts is settled on that device.** Removal is
refused while anybody is named on a live entry, but that needs both facts on
one phone — so removing Bruno while Bruno's phone is offline leaves him a
*ghost*: `device.meByGroup` still points at him, the claim gate passes, and
every entry naming him is refused with nothing on screen saying why. On sync,
a phone whose claimed member is tombstoned resolves it itself: if the stranding
detector still names them, lift it — *"Bruno came back"* — and otherwise the
removal was uncontested, so the phone forgets the group, keeping the secret the
way [`leftGroups`](data-model.md#entities) already does.

Signing as the subject rather than an actor is what lets this run in
`syncGroup`, where merges actually happen, rather than waiting for somebody to
open a screen with a claimed identity. It also makes the empty group
unobservable rather than prevented: two people who remove each other and share
no money both forget, and nobody is left looking.

## Open questions

- **Is "forget" right for an uncontested removal?** It is the only place the
  app makes a group silently disappear from somebody's list. The alternative —
  always come back — makes removal unwinnable against an installed phone, and
  ping-pongs at human pace with neither side told why.
- **Does the log stay small enough?** Whole-entity ops repeat every field on
  every edit, and a receipt-scanned expense is not small. Ops are never
  collected ([sync.md](sync.md#gotchas)), so this wants measuring on a real
  group before it ships, not arguing about.
- **Should `nameTaken` survive at all** once adding converges? A hint that says
  "this joins the existing Ana" is arguably better than a refusal, and would be
  the first screen to admit that one name is one person rather than assert it.
- **Where does the last healer live?** A cleared rate that a live entry still
  spends in has no repair yet, and it is the same shape as the member one: the
  tombstone is the half the log contradicts, and `setRate` already writes the
  lift.

## Gotchas

- **A guard and its healer must be one declaration.** `memberInvolved` (the
  refusal) and `strandedMembers` (the detector) are two functions that happen
  to agree, and will drift. Every defect in this file so far was a guard whose
  healer was never written — the check looked like enforcement, so nobody asked
  what happened when it lost.
- **Healers must not fight.** One that tombstones and one that lifts, pointed
  at the same row, is an op loop that syncs. Whatever runs them has to reach a
  fixed point and be tested for it, especially once healing moves onto the sync
  path where a repair triggers the push that triggers the repair.
- **The name-as-identity decision earns an ADR when it is built** — it is
  expensive to reverse, and a future session will argue with it. Not before:
  an ADR records a decision the code already obeys
  ([decisions/](decisions/README.md)).
