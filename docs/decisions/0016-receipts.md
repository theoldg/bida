# 0016 — A scanned receipt is a split mode of its own

**Status:** Accepted · 2026-08-28

**Context.** The owner asked to photograph a bill and assign its lines: *"a
selection of involved users … then a table with columns as users and rows as
items."* That table is restaurant bill splitting in shape — the entity
[product.md](../product.md) defers, with line items as "a new entity with its
own op kinds".

## Decision

**The who-had-what grid is its own `SplitMode`: `receipt`.** Each item's
printed amount is divided evenly among its checked members by `resolveSplit`,
summed per member, and used as a weight — a ratio against the FX-converted
total, so it needs no currency conversion of its own. No new entity, no new op
kind; the seam `product.md` describes is untouched.

Weighted division is the same arithmetic `shares` does, **and that is the whole
of what the two have in common**: one is a bill read out, the other is parts
somebody chose. They were one mode for a while, a `shares` spec with a
`splitTab: "receipt"` flag beside it, and every screen that named a split had
to ask both fields what it was really looking at (`fromReceipt`). Each of them
got it wrong somewhere: the ledger row said "as parts", the log said "Teo ×3943
parts" over weights nobody typed, leaving Receipt for As parts arrived with the
bill's own weights in it. A receipt is a mode, it names itself
(`copy.split.mode`), and nothing asks a second field.

**The parsed bill lives on the expense, not in the draft.** `receiptItems`,
`receiptTip`, `receiptInvolved` and `receiptAssignments` are ordinary optional
fields on `Expense`, travelling in the op's `patch` like `description` — so they
sync, replay and fold with no change to `Op`, `fold.ts`, the D1 schema or the
Dexie schema, and the grid reopens later from any device. Ops already written
in the old shape are upgraded in one place, `upgradeReceiptSplit`, where ops
become state (`applyPatch`, so the fold and the history read it alike); the
materialised Dexie cache in front of them takes the same function on open
(`version(7)`), since it is only refolded when a pull brings ops.

**Receipt is the fourth tab on the split editor**, and a fourth *answer* beside
the three, never a rewrite of one of them — a scan used to convert whatever As
parts held into its own weights ([ADR-0010](0010-what-an-entry-is.md)).
Which tab is showing is the draft's business and never the entry's (`SplitTab`,
`lib/draft.ts`): a tab is a mode, and a saved entry's mode is what reopens it.

**The handoff runs one way: the bill never seeds an arithmetic tab.** The three
feed each other, so "even, then nudge one person" costs one tap
(`arithmeticSplit`, the only basis `openSplitTab` converts from). A scan feeds
none of them. Both directions of the leak are shut: leaving Receipt for a
first-time As parts arrived at the grid's weights, and reopening a saved
receipt expense seeded the tabs from its stored `shares` spec — which is the
grid's own arithmetic, not parts anybody chose. Either way As parts opened
holding a number the scan had put there, on a screen it does not own, and
editing it produced a split that agreed with neither. The arithmetic tabs now
start where an unscanned entry starts: even, over everyone.
**The tab is a claim, and Save is held until it is true**: with
no bill scanned, or a bill nobody has been assigned a line of, there is no
receipt split, and saving stored "Receipt" over an ordinary even one. What a
save writes is the mode the split actually is, so a person who scans a bill and
then switches back to Evenly saves an `equal` split beside their items, and
reopens on Evenly. The
holding is said in the split editor's footer, where every other unfinished
split is complained about, not up beside Save. While the tab has items the
amount field mirrors `receiptTotalMinor`, disabled — *"when in receipt mode I
shouldn't be able to change the price"* — so a misread total is fixed on the
item or by rescanning.

**Nothing derived is ever cached.** The total and the split are computed fresh,
inline, where both are read: the form's render. The who-had-what screen writes
only raw inputs. Every bug in this feature's first week was a derived value
mirrored into a draft field by an effect on one screen watching a write made by
another. Recomputing is one cheap call; the cache was the bug. Leaving Receipt
hands the total over exactly once (`handOffReceiptTotal`), beside the split a
first-time tab is handed (`openSplitTab`) — two handoffs made in the handler
that switched tabs, not mirrors anything later resyncs.

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

- The computed split is stored as weights, accurate if a little abstract next to
  the photograph, and the tip scales to what each person ordered — an even split
  only while nobody has ordered anything. Each person's row on the entry screen
  opens onto their own lines of the bill (`receiptBreakdown`), which is the
  concrete reading of those weights.
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
