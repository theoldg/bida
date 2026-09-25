# 0016 — A scanned receipt is a split mode of its own

**Status:** Accepted · 2026-08-28 (discounts and tax, 2026-09-12; a bill may be
typed rather than photographed, 2026-09-19)

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
bill's own weights in it. A receipt is a mode — **"By items"**, because the
photograph is how the lines got typed in and a mode's name is how the money
divides — it names itself (`copy.split.mode`), and nothing asks a second field.

**A photograph is how the lines usually got in, and not the only way.** A bill
may be typed or pasted instead — the same reading, the same envelope with one
`mimeType` changed, the same arithmetic after it — so nothing in this decision is
about a camera. What the medium changes is covered in
[receipt-scanning.md](../receipt-scanning.md#typing-a-bill-in), including the one
thing it costs: a typed bill puts a caller's own words in front of the shared
Gemini key, which the envelope used to make impossible.

**The parsed bill lives on the expense, not in the draft.** `receiptItems`,
`receiptTip`, `receiptInvolved`, `receiptAssignments` and `receiptText` are
ordinary optional fields on `Expense`, travelling in the op's `patch` like `description` — so they
sync, replay and fold with no change to `Op`, `fold.ts`, the D1 schema or the
Dexie schema, and the grid reopens later from any device. Ops already written
in the old shape are upgraded in one place, `upgradeReceiptSplit`, where ops
become state (`applyPatch`, so the fold and the history read it alike). The
Dexie migration that carried the materialised cache over has been collapsed
away with the rest of the chain
([data-model.md](../data-model.md#indexeddb-dexie-schema-v8)); the fold is what
holds it now.

**The receipt split is the fourth tab on the split editor** — labelled
"Items", for what the tab holds rather than for the photograph — and a fourth
*answer* beside
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
A bill arrives with such a line already as N rows, each carrying its share of
the printed amount and its own eaters; tapping the count only folds and opens
them as a view, so it is never an edit, and `weightsFromItems` learns nothing
new. Portions are marked (`portionOf`), never
inferred from equal labels, and sum to the printed line exactly, because a
display control must not move the bill's total. Only a count the receipt
printed is unfolded: deciding a line was really three is data entry.

**A discount is shared in proportion to what each person ordered**, and so are
the tip and any tax charged on top: they are one family (`BillExtras`), the
lines a bill charges for that nobody ordered, and none of them can be ticked
for. Every deduction is gathered into one list first (`readBill`) wherever it
printed — a negative line item, a bill-level credit, a two-for-one — because
the grid has no way to say who a particular credit belongs to, and inventing
one is a scope-picking UI on a screen asked to be minimal. They are kept apart
rather than summed, and collapse behind the same `×N` a repeated item wears,
because the arithmetic does not care and a person reading the bill does.

Proportional is not the fallback it looks like. Take the owner's own case: ham
pizza 10, cheese pizza 8, "buy 1 get 1 free" −8. Crediting the cheaper pizza
literally leaves the ham eater paying 10 for a promotion their own order
created; splitting it evenly makes the cheaper pizza subsidise the dearer one,
which no other rule in the app does. Pro rata (5.56 / 4.44) is the same rule a
whole-bill loyalty deduction follows, and a whole-bill deduction spread this
way moves nobody relative to anybody — only the total changes. One rule, both
scopes.

**A bill is shown in the language it was printed in**, with English one tap
away on the bar (`billLabel`). The scan returns both, so this costs a field and
no second call. Printed-by-default is the whole ruling: the person tapping the
grid is holding the paper, and a screen that silently renames "Tajine" to "Lamb
stew" cannot be checked against it — the translation is for reading a bill you
can't, which is a choice and not the resting state. The choice is the phone's
and not the group's, and it reaches every reading of that bill: the grid, each
person's lines on the entry screen, and a quick split's text.

**The grid's initials are `distinctInitials()`**, growing each prefix until it
is unique ("John"/"Jane") but **never past three graphemes** — they are the
column headings, so they set the column width, and "Bartholomew" beside
"Bartholomew Junior" grew until the bill had no room left. Whoever still
collides at three is numbered instead ("Ba1"/"Ba2"), counting from 1 again at
each prefix ("Ma1 Ma2 Ju1 Ju2"), and a group where any name
already holds a digit gives up on unique codes and takes the bare prefixes,
repeats and all: three characters cannot be injective over arbitrary names, and
the chips above the grid carry the full names. Local to the one place initials
survive at all ([0023](0023-monospace-monochrome.md)).

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
- **A scope on each discount** — which lines it came off, picked on the grid.
  It is the honest model and the seam is left at `readBill`, but it buys a
  line-picker dialog for an answer pro rata already gets right whenever the
  people who shared the discounted items are the people who ordered them.
- **Deriving the receipt total on every tab** — it would make the amount field
  unownable, which is the entire point of switching to Evenly.
