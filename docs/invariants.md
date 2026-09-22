# Invariants and how they are held

*For: anyone adding a check that reads other entities, or touching member
identity or the merge rule.*

Every invariant in the table below is held by something the code enforces, not
by a doc. This file is the map — what each one is held by, why guards alone
are never enough, and what a new one has to do to be added.

**Why this class and not another.** Every other bug costs a screen. These cost
the ledger, and quietly — nobody asked for the money to move, so nobody is
looking when it does.

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
   and a repair that folds it away, declared together in `core/invariants.ts`.
   The five rules one must satisfy are stated there, beside the type that
   requires them, and `invariants.test.ts` holds every registered entry to them.
3. **Courtesy** — a UI refusal, which is a kindness to whoever is holding the
   phone and **not** a correctness mechanism. Every guard in the app is this,
   whether or not it was written believing so.

Reads of other entities are safe when their failure mode is **convergence**,
not **refusal**: missing a match yields a duplicate a healer folds away, while
missing a refusal yields a state with no trace to repair from.

## What holds each invariant

| Invariant | Held by | Status |
|---|---|---|
| Money is an integer, minor units, positive | types, `core/money.ts` | held |
| A split resolves to exactly `baseAmountMinor` | `core/split.ts` | held |
| Balances sum to zero | derived on read, `touch()` | held |
| One rate per currency per group | natural key (the currency code) | held |
| One identity row per device per group | natural key (the node id) | held |
| A live entry names only live members | healer — `liveEntriesNameLiveMembers` | held |
| An entry's derived fields agree with its own (`paidBy` ∈ `payers`) | unreachable — whole-entity merge | held |
| A device's claimed member is live | healer — `restoreClaimDrafts` | held |
| A group has at least one live member | follows from the above | held |
| Two live members never share a `nameKey` | natural key (the name) | held — legacy groups excepted |
| A currency with live entries has a live rate | healer — `liveEntriesHaveLiveRates` | held |

## Why each is held the way it is

The merge rule and the name key are the two worth copying: each retires an
invariant rather than registering a healer for it.

**An entry merges whole, not per field**
([ADR-0002](decisions/0002-append-only-op-log.md),
[sync.md](sync.md#the-operation)). It belongs on this list because of what it
removes: an amount from one phone beside a split from another that does not sum
to it is the one case no healer could repair — nothing recovers intent from two
half-edits. Making every stored entry a version somebody looked at turns that
invariant **unreachable**, which is always the answer to prefer.

The two amendments are what keep it from breaking the healers: `deletedAt`
merges per field, so a save made offline cannot re-tombstone what a repair just
lifted, and `createdAt` is write-once in the fold rather than merely documented
as such.

**A member's name is their identity, and neither can be renamed.**
`memberId = hash(groupId + nameKey)`, so two phones adding "Ana" offline mint
the *same id* — the creates are one entity, the fold merges them, and there is
no duplicate to find. The refusal on the field stays, because it costs nothing
and catches every case one device can see both halves of, and says what to do
rather than only saying no. The reasoning, what it costs and what was
rejected: [ADR-0034](decisions/0034-a-member-is-their-name.md).

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

It signs as the subject, not as whoever noticed, and that is what lets it run
in `syncGroup` — where merges actually happen — rather than waiting for
somebody to open a screen. All healing runs there, for the same reason: a
local write is refused before it lands, so a merge is the only thing that can
produce an illegal state. It also makes the empty group impossible
rather than merely rare, since every claimed member's phone restores them.

It is the one repair the registry cannot hold, and `restoreClaimDrafts` lives
beside it saying why: a registered detector sees only `GroupState`, and the
premise here is *which member this phone is*. Registered, every device would
resurrect every claimed member and forgetting would end nothing.

## Open questions

- **What does the removal sheet promise?** If a claimed phone always
  restores its person, removal only sticks against somebody who has forgotten
  the group or lost the phone. That is the intended behaviour, but the sheet
  still reads as though removing is final, and it is the one screen that would
  then be lying.
- **Does the log stay small enough?** Measured, and the answer is yes:
  whole-entity ops cost about 2.5x, and a scanned expense's `receiptItems` is
  most of what the database holds
  ([hosting.md](hosting.md#how-full-can-it-get)). Ops are never collected
  ([sync.md](sync.md#gotchas)), so it wants re-measuring rather than
  re-arguing; compaction, if it is ever needed, is one rule.

## Enforcement

Docs are how a cold agent learns this; they enforce nothing — a guard
described correctly in a doc can still ship without a healer. And the server
cannot help — it stores ops and assigns `seq`, it never
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

- **A guard and its healer must be one declaration.** Two functions that happen
  to agree — one refusing, another detecting — drift, and a guard looks like
  enforcement, so nobody asks what happens when it loses. `Invariant` requires
  the repair and makes the refusal the optional half.
- **Healers must not fight.** One that tombstones and one that lifts, pointed
  at the same row, is an op loop that syncs. Whatever runs them has to reach a
  fixed point and be tested for it, since on the sync path a repair triggers
  the push that triggers the repair.
