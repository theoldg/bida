# 0016 — A scanned receipt reduces to an ordinary split

**Status:** Accepted · 2026-08-28

**Context.** The owner asked to photograph a bill and assign its lines: *"a
selection of involved users ... then a table with columns as users and rows as
items."* That table is restaurant bill splitting in shape — the entity
[product.md](../product.md) lists as deliberately deferred, with line items as
"a new entity with its own op kinds". Building it would mean a schema change
nobody asked for, for a UI feature asked for today.

## Decision

**The who-had-what grid reduces to an ordinary `shares` split.** Each item's
printed amount is divided evenly among its checked members by `resolveSplit` —
the same largest-remainder rule as a real split — summed per member and used as
a weight. Weights are a ratio against the FX-converted total, so they need no
currency conversion of their own. No new entity, no new op kind; the seam
`product.md` describes for real bill-splitting is untouched.

**The parsed bill lives on the expense, not in the draft.** `receiptItems`,
`receiptTip`, `receiptInvolved`, `receiptAssignments` and `splitTab` are
ordinary optional fields on `Expense`, travelling in the op's `patch` like
`description` — so they sync, replay and fold with no change to `Op`, `fold.ts`,
the D1 schema or the Dexie schema, and the grid reopens later from any device.

**Receipt is a fourth tab on the split editor**, not a fifth `SplitMode`. A
finished grid *is* a split, just arrived at differently; showing it under "As
parts" would lose where it came from. `SplitTab` is its own type, saved on the
expense — deriving it from "are there items?" made every save silently drop a
deliberate switch back to Evenly.

**While the tab has items, the total is computed, not typed.** `receiptTotalMinor`
sums the lines plus the tip and the amount field mirrors it, disabled — the
owner: *"when in receipt mode I shouldn't be able to change the price."*
Correcting a misread total means fixing the item or rescanning, which is
available on any entry, saved or not.

**Nothing derived is ever cached.** The total and the split are computed fresh,
inline, in the one place both are read — the form's render. The who-had-what
screen writes only the raw inputs. Every bug in this feature's first week was a
derived value mirrored into a draft field by an effect on one screen watching a
write made by another: `0 of 0 allocated`, a blocked Save, a total that
evaporated on a tab switch. Recomputing is one cheap call; the cache was the bug.

**Leaving Receipt for an arithmetic tab hands the total over, once**
(`handOffReceiptTotal`). This is the missing half of the handoff `convertSplitMode`
already makes for the split — not a reinstated mirror. And a zero total is never
rendered as a satisfied split: `splitFooter` owns the verdict and says "Enter an
amount to split", so the nonsense string is unreachable rather than guarded at
each call site.

**A "×2" line unfolds into portions, and a portion is an ordinary line.**
Tapping the count replaces the row with N rows, each carrying its share of the
printed amount and its own eaters; tapping again merges them back. Nothing
downstream learns a new concept — `weightsFromItems` and `receiptTotalMinor` are
untouched. Portions are marked (`portionOf`), never inferred from equal labels,
and they sum to the printed line exactly, because a display control must not
move the bill's total. Unfolding is offered only where the receipt printed a
count: deciding a line was really three is data entry, not splitting.

**Distinct initials, not the app's usual ones.** "John" and "Jane" both read "J";
`distinctInitials()` grows each prefix only as far as needed to stay unique. It
is local to this grid, which is also the one place initials survive at all
([0023](0023-monospace-monochrome.md)) — there they are column headings.

## Consequences

- The computed split shows as `shares`, which is accurate if a little abstract
  next to the photograph.
- Reopening a saved receipt expense recomputes its total and split from the
  items rather than trusting the stored values — correct, since those inputs are
  exactly what produced them, with the same seeded tiebreak.
- The tip scales to what each person ordered, falling back to an even split only
  when nobody has ordered anything yet.
- `receiptItems` stays a flat list of plain objects, so it survives the op log
  and old expenses unchanged.
- The Receipt tab is offered on expenses only: an income has no bill to read.

## Rejected

- **A `lineItem` entity now** — real scope creep for a screen asked to be
  minimal; no schema change until the split needs to be re-editable per item.
- **`exact` amounts instead of weights** — every item would need converting
  through a possibly still-being-typed FX rate before it could be assigned.
- **A row holding N sub-assignments** instead of unfolding — it makes
  `receiptAssignments` three-dimensional and gives every reader a second case.
- **A `receiptTipPercent` field** — the items already carry the proportional
  information.
- **Deriving the receipt total on every tab** — it would make the amount field
  unownable, which is the entire point of switching to Evenly.
