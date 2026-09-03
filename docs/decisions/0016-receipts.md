# 0016 — A scanned receipt reduces to an ordinary split

**Status:** Accepted · 2026-08-28

**Context.** The owner asked to photograph a bill and assign its lines: *"a
selection of involved users … then a table with columns as users and rows as
items."* That table is restaurant bill splitting in shape — the entity
[product.md](../product.md) defers, with line items as "a new entity with its
own op kinds".

## Decision

**The who-had-what grid reduces to an ordinary `shares` split.** Each item's
printed amount is divided evenly among its checked members by `resolveSplit`,
summed per member, and used as a weight — a ratio against the FX-converted
total, so it needs no currency conversion of its own. No new entity, no new op
kind; the seam `product.md` describes is untouched.

**The parsed bill lives on the expense, not in the draft.** `receiptItems`,
`receiptTip`, `receiptInvolved`, `receiptAssignments` and `splitTab` are
ordinary optional fields on `Expense`, travelling in the op's `patch` like
`description` — so they sync, replay and fold with no change to `Op`, `fold.ts`,
the D1 schema or the Dexie schema, and the grid reopens later from any device.

**Receipt is a fourth tab on the split editor**, not a fifth `SplitMode`: a
finished grid *is* a split, arrived at differently, and showing it under "As
parts" would lose where it came from. `SplitTab` is saved explicitly — deriving
it from "are there items?" made every save silently drop a deliberate switch
back to Evenly. While the tab has items the amount field mirrors
`receiptTotalMinor`, disabled — *"when in receipt mode I shouldn't be able to
change the price"* — so a misread total is fixed on the item or by rescanning.

**Nothing derived is ever cached.** The total and the split are computed fresh,
inline, where both are read: the form's render. The who-had-what screen writes
only raw inputs. Every bug in this feature's first week was a derived value
mirrored into a draft field by an effect on one screen watching a write made by
another. Recomputing is one cheap call; the cache was the bug. Leaving Receipt
for an arithmetic tab hands the total over exactly once
(`handOffReceiptTotal`) — the missing half of the handoff `convertSplitMode`
already makes, not a reinstated mirror.

**A "×2" line unfolds into portions, and a portion is an ordinary line.**
Tapping the count replaces the row with N rows, each carrying its share of the
printed amount and its own eaters; tapping again merges them back, and
`weightsFromItems` learns nothing new. Portions are marked (`portionOf`), never
inferred from equal labels, and sum to the printed line exactly, because a
display control must not move the bill's total. Unfolding is offered only where
the receipt printed a count: deciding a line was really three is data entry.

**The grid's initials are `distinctInitials()`**, growing each prefix until it
is unique ("John"/"Jane"), and local to the one place initials survive at all
([0023](0023-monospace-monochrome.md)) — there they are column headings.

## Consequences

- The computed split shows as `shares`, accurate if a little abstract next to
  the photograph, and the tip scales to what each person ordered — an even split
  only while nobody has ordered anything.
- Reopening a saved receipt expense recomputes its total and split from the
  items rather than trusting the stored values: those inputs are exactly what
  produced them, with the same seeded tiebreak.
- `receiptItems` is a flat list of plain objects, so it survives the op log and
  old expenses unchanged. The tab is offered on expenses only — an income has no
  bill to read.

## Rejected

- **A `lineItem` entity now** — real scope creep for a screen asked to be
  minimal; no schema change until the split needs to be re-editable per item.
- **`exact` amounts instead of weights** — every item would need converting
  through a possibly still-being-typed FX rate before it could be assigned.
- **A row holding N sub-assignments** instead of unfolding — it makes
  `receiptAssignments` three-dimensional and gives every reader a second case.
- **A `receiptTipPercent` field** — the items already carry the proportion.
- **Deriving the receipt total on every tab** — it would make the amount field
  unownable, which is the entire point of switching to Evenly.
