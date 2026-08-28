# 0019 — Receipt mode owns the total; the tab choice persists

**Status:** Accepted · 2026-08-28 · **Partially supersedes [0016](0016-receipt-scan-ux-and-item-assignment.md) and [0018](0018-receipt-as-a-fourth-split-tab.md)**

**Context.** The owner's first real use of Receipt mode surfaced three bugs
that all traced back to the same two decisions:

1. ADR-0018 made `SplitTab` "UI-only draft state... derived when absent" from
   whether `receiptItems` is present. But `receiptItems` is kept on the
   expense forever (ADR-0017), and `splitTab` was never written onto the
   expense at all — only the local draft. So every save silently dropped it,
   and reopening any expense that was ever scanned re-derived "Receipt",
   even after the owner had deliberately switched to Evenly and saved. Their
   report: *"when i switch to a different mode, save and come back, it jumps
   back to receipt mode."*
2. The amount field was always freely editable, with no link back to the
   items it was supposed to represent — a scan sets it once, from the OCR's
   guess at the printed total, and afterwards it and the items could say two
   different things. A blank or unread total (OCR caught line items but
   missed the printed total) left the split editor computing against a real
   `0`, which reads as *fully allocated* (`allocated === total === 0`) rather
   than incomplete — printing the nonsensical "€0.00 of €0.00 allocated" and
   surviving a tab switch because nothing ever recomputed it. Their report:
   *"when trying to switch back to other modes it goes stupid saying 0 of 0
   allocated. When in receipt mode I shouldn't be able to change the price."*

Also reported: the tip split evenly across everyone present regardless of
what they ordered, there was no way to add a tip that the scan didn't catch,
and rescanning was unavailable the moment an expense was saved once
(ADR-0016's "new-expense-only" rule), even to fix a bad read.

## Decision

- **`splitTab` is a real field on `Expense`**, written by `addExpense` and
  `editExpense` exactly like `receiptItems`. Reopening an expense now reads
  its saved tab; the "derive from `receiptItems`" heuristic only fires for
  expenses saved before this field existed.
- **While the Receipt tab has items, the amount is computed, not typed**:
  `receiptTotalMinor()` (`lib/scan/items.ts`) sums the line items plus the tip
  in the receipt's own currency, and the form's amount field mirrors that
  value and is disabled. Editing the total no longer has a way to drift from
  what the items say — change the items or the tip instead, or switch to
  Evenly/As parts/As amounts to take manual control of the number back (which
  now also sticks, per the point above).
- **The tip scales to what each person already ordered.** `weightsFromItems`
  used to hand the tip to `resolveSplit` in `"equal"` mode across everyone
  marked present; it now builds a `"shares"` spec from each tip member's
  existing item weight, so a €40 order tips more than a €10 one. Falls back to
  an even split only if none of the tip's members have ordered anything yet
  (nothing to be proportional to). A tip is also now directly editable on
  `/g/expense/items` — a plain amount field, not only whatever the scan read.
- **Scanning/rescanning is available on any expense, saved or not** —
  ADR-0016's `canScan = !draft.expenseId` restriction is gone. A rescan
  already replaced `receiptItems`/`receiptTip` and reset the who-had-what grid
  regardless of that flag; the flag only ever hid the button, on the
  expense you're most likely to want to fix a bad scan on.

## Consequences

- `Expense.createdAt` also shipped alongside this (unrelated bug, same
  session): the expense/activity list sorted only by `occurredAt`, which is a
  user-editable date, so same-day entries had no reliable order. `createdAt`
  is set once at creation and used as the sort tiebreak; both fields are
  optional so expenses written before either existed still fold and display,
  falling back to `occurredAt` for the tiebreak.
- A receipt's total is now a derived fact, not an independent one — correcting
  a misread total means fixing the relevant item or the tip, not the amount
  field. This is the trade the owner asked for ("I shouldn't be able to
  change the price"); a wildly misread item is fixed by rescanning (now always
  available) rather than hand-editing a number that no longer matches anything.
- `ReceiptTabProps.canScan` is removed rather than left unused — nothing reads
  it any more, so keeping it would just be dead configuration.

## Rejected

- **A `receiptTipPercent` field instead of scaling by existing weights.** The
  owner's items already carry the real proportional information; a separate
  percentage would be one more number to keep in sync with the same fact for
  no benefit.
