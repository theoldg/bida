# 0028 — Three kinds of entry: expense, income, transfer

**Status:** Accepted · 2026-08-30

**Context.** The owner: *"the app should have transfers, expenses and incomes
like tricount. reimbursements should be a transfer, and everything should be
editable."*

The app had two of the three and called neither by the right name. An expense
was the only thing you could add; a settlement existed but was a
*reimbursement*, reachable only from the settle-up list, with no detail screen
and no way to edit it once saved. Money coming *in* — a deposit returned, a
prize, a ticket sold on — had nowhere to go but a negative-shaped lie in a
description.

## Decision

**Income is one field on an expense.** `Expense.kind?: 'expense' | 'income'`,
absent meaning expense forever. An income has the same positive amount, the
same `payers` map, the same `split` and the same validation; the sign is applied
in exactly one place, `computeBalances`, where the receivers are debited and the
sharers credited. Nothing else in `packages/core` branches on it.

**A transfer is the `Settlement` we already had, renamed in the only place a
rename costs nothing: the words.** Every screen says *transfer*;
"reimbursement" is gone. The type, the op `entity` and the D1 column keep
saying `settlement`, because every op ever written does, and a rename there
buys a migration and no behaviour. `apps/web/lib/entry-kind.ts` is the one
place the three-way vocabulary lives.

**One form, one detail screen.** `/g/entry/edit` is a segmented control over
all three and swaps only the middle of the form; the amount, currency, date and
words survive a change of mind because they are the same fields either way.
`/g/entry` looks its id up in both tables. `/g/settle` is deleted — settling up
links into the form with the transfer pre-filled — and `/g/expense*` is
`/g/entry*`, since two of the three things on those routes are not expenses.
Same reason the first tab is now **Ledger**.

**Everything is editable.** `editSettlement` joins `editExpense`, with the same
changed-fields-only patch; a transfer gets a detail screen, a history and a
restore like anything else on the log.

## Consequences

- **No migration.** An expense written before today folds and renders
  identically: it has no `kind`, and absence is the ordinary case. Ops carry
  `kind` only on an income, so nothing common gets bigger.
- `BalanceReport` gains `totalIncomeMinor`, `receivedMinor` and
  `incomeShareMinor`. Income is **never netted into** `totalSpendMinor` — "what
  did the trip cost" and "what did it take in" are different questions, and the
  balances card asks the second one only when there is an answer.
- Expense ↔ income is an edit (one field). Expense ↔ transfer is not offered:
  it is a different entity with a different shape, so the segmented control
  shows only what is reachable and is not drawn at all when editing a transfer.
- A bookmarked `/g/expense`, `/g/expense/edit` or `/g/settle` 404s.
- The Receipt tab is offered on expenses only. An income has no bill to read a
  total off, and leaving the tab takes the same handoff as any other tab switch
  (ADR-0021).
- History says "entry" rather than guessing on an edit whose op didn't carry
  `kind` — a wrong noun in the log is worse than a general one.

## Rejected

- **A separate `income` entity.** It would duplicate `payers`, `split`,
  `receiptItems` and every validation in core, add an op entity kind and a
  Dexie store, and give two identical screens for two things that differ by a
  sign.
- **A negative `amountMinor`.** One field, no new entity — but every piece of
  split and payer arithmetic, every validator and the receipt scanner assume a
  positive total, so the cost lands as sign handling in a dozen places instead
  of one.
- **Renaming the `settlement` entity to `transfer`.** Honest, and it would
  invalidate every op already on a log for a word no user ever sees. The
  vocabulary file does the same job for free.
- **A speed-dial FAB offering three targets.** Two taps for the overwhelmingly
  common case, and a control that answers a question the form is about to ask
  anyway.
- **Keeping `/g/settle`.** Recording a payment is entering a transfer. A second
  screen for it is the second way to do one thing that the standing
  instructions say to delete.
