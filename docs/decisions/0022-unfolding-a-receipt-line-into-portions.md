# 0022 — A "×2" line unfolds into portions; a portion is an ordinary line

**Status:** Accepted · 2026-08-28 · **Builds on
[0016](0016-receipt-scan-ux-and-item-assignment.md),
[0017](0017-receipt-items-persist-on-the-expense.md)**

**Context.** A receipt prints `Salade marocaine ×2  9.00` as one line, and the
who-had-what grid gave it one row: one set of eaters for both salads. But the
common restaurant case is the one the owner asked for — Alice and Bob shared
one, Charlie had the other. One row cannot say that. Ticking all three splits
€9.00 three ways, which is wrong by €1.50 for everybody.

## Decision

**Unfolding rewrites the bill's lines. It does not add a second dimension to
the grid.** Tapping the `×2` on a row replaces it with two rows, each carrying
half the printed amount and its own set of eaters; tapping the (now
highlighted) `×2` on the group merges them back. `unfoldItem` /
`foldPortions`, `lib/scan/items.ts`.

The alternative — a row that holds N sub-assignments — would have made
`receiptAssignments` a three-dimensional array and given every reader of the
grid a second case to handle. This way *nothing downstream learns a new
concept*: portions are line items like any other, `weightsFromItems` and
`receiptTotalMinor` are untouched, and the grid still reduces to an ordinary
`shares` split (ADR-0016).

**Portions are marked, not inferred.** Each carries `portionOf: N`, and a run
of N consecutive lines with the same label and the same N is one unfold
(`portions()`). Grouping by equal labels alone would have drawn a bracket
around a receipt that simply printed the same dish twice, and could not have
merged back the odd-cent case exactly.

**The portions sum to the printed line, exactly.** The remainder goes to the
earliest portions a minor unit at a time (9.01 over three is 3.01 + 3.00 +
3.00), because the bill's total — and therefore the expense's amount, which
Receipt mode derives from it (ADR-0019) and the tip percentage read off it —
must not move when someone taps a display control.

**Unfolding is offered only where the receipt printed a count.** `quantity`
stays what ADR-0016 said it was — what the model read, never inferred — and is
now what says how many portions a line has in it. A line with no printed count
is one thing; deciding it was really three is data entry, not splitting, and
the per-row member toggles already handle sharing one thing.

## Consequences

- `receiptItems` gains one optional field and stays a flat list of plain
  objects, so it survives the op log and old expenses unchanged (ADR-0017).
  `ReceiptItem` is now declared once, in core, instead of three times.
- The grid writes `receiptItems` **and** `receiptAssignments` together when a
  line unfolds, keeping "one assignment row per item" true even if the screen
  is left without pressing Done — the invariant its own seeding relies on.
- A run broken by a later edit degrades to ordinary lines: no bracket, no
  merge control, no crash.
- Merging is offered on any group of portions, including one restored from a
  saved expense — the marks travel with the bill, not with the session.
