# 0018 — Receipt scan and who-had-what move into a fourth split tab

**Status:** Accepted · 2026-08-28

**Context.** ADR-0016 put the scan/upload buttons and the "Edit who-had-what"
link at the top of the expense form, above the amount — reasonable when they
were the first thing you'd do, but they then sat disconnected from the
`SplitEditor`'s "Evenly / As parts / As amounts" tabs even though a finished
scan *is* a split, just arrived at differently. The owner asked for it to live
next to the other splitting options instead.

## Decision

- **A fourth tab, "Receipt", in the `SplitEditor`'s segmented control.**
  Before a scan: the camera/upload buttons and privacy line move here from the
  top of the form. After one: the item count and "Edit who-had-what" link
  render here instead of as a separate block. `ReceiptTabProps` and
  `ReceiptPanel` in `components/split-editor.tsx` carry the scan state and
  handlers down from the form, which still owns the file inputs and
  `scanReceipt()` call — only where the buttons render moved.
- **`SplitTab` is a new type (`lib/draft.ts`), not a fifth `SplitMode`.** A
  finished who-had-what grid still reduces to an ordinary `shares` `SplitSpec`
  (ADR-0016 stands unchanged) — but showing that spec under "As parts" would
  lose the fact that it came from a receipt. `SplitTab` (`equal | shares |
  exact | receipt`) is UI-only draft state, tracking which tab is showing
  independent of what the underlying spec's `mode` is. Undefined (an old draft,
  or an expense saved before this field existed) derives from the data: a
  present `receiptItems` array means "Receipt", otherwise the spec's own mode.
- **Switching to one of the three arithmetic tabs still calls
  `convertSplitMode`** exactly as before; it also records the tab explicitly.
  Switching *to* Receipt doesn't touch the spec — there may not be one yet.
- **Scanning stays new-expense-only** (`canScan = !draft.expenseId`, unchanged
  from ADR-0016); editing an existing expense's Receipt tab without a scan
  shows an explanatory line instead of buttons, rather than hiding the tab.
- **The allocation footer ("€x of €y allocated") hides on an empty Receipt
  tab.** It reflects whatever `spec` currently is — often still `equal` before
  a scan runs — and showing that verdict under a tab that hasn't produced a
  split yet would read as a claim about the wrong thing.

## Consequences

- One more piece of state to seed (`splitTab`) alongside `split` on the
  draft, but it's optional and derived when absent, so nothing that read a
  draft or an `Expense` before this change breaks.
- The who-had-what grid itself (`/g/expense/items`) is unchanged — this only
  moves its entry point.
