# 0010 — Three kinds of entry, and several people may have paid

**Status:** Accepted · 2026-08-27 · kinds 2026-08-30 · kind chip 2026-09-11 ·
expense ↔ transfer 2026-09-20

**Context.** Two asks, a month apart, about the same record. First, expenses
several people chip in on — *"Bob paid 400 and Alice paid 100 for these 500
spent on people XYZ"* — where `paidBy` was a single member id credited the whole
amount. Then: *"the app should have transfers, expenses and incomes like
tricount. reimbursements should be a transfer, and everything should be
editable."* Money coming *in* had nowhere to go but a negative-shaped lie in a
description.

## Decision

**Income is one field on an expense.** `Expense.kind?: 'expense' | 'income'`,
absent meaning expense forever. An income has the same positive amount, the same
`payers`, `split` and validation; the sign is applied in exactly one place,
`computeBalances`, where receivers are debited and sharers credited. Nothing
else in `packages/core` branches on it.

**A transfer is the `Settlement` we already had, renamed in the only place a
rename costs nothing: the words.** Every screen says *transfer*. The type, the
op `entity` and the D1 column keep saying `settlement`, because every op ever
written does. The vocabulary lives in `copy.entryKind`
([0033](0033-every-word-in-one-file.md)); `lib/entry-kind.ts` keeps the types
and the arithmetic that decide which of the three an entry is.

**Several payers are an optional map.** `Expense.payers?: Record<Id, number>`,
in the expense's **own currency**, summing to `amountMinor`. Absent means what
it always meant; present, it wins, and `paidBy` is maintained as the largest
contributor so older clients and list rows still read. `resolvePayers`
apportions `baseAmountMinor` with the same seeded largest-remainder rule a
`shares` split uses, so the payer side sums to the base total exactly.

**One form, one detail screen, everything editable, all three kinds always
reachable.** `/g/entry/edit` is one chip naming the kind, centred on the top
bar, and swaps only the middle of the form; the amount, currency, date and
words survive a change of mind, whichever pair of kinds it is. A chip rather
than three buttons because nothing opens this form asking for an income and
settle-up prefills the transfer: the kind is already right on nearly every
entry, so it is worth one tap on the rare one and none on the rest. The split
editor is inline on it, in three modes — Evenly · As parts · As amounts
(`equal`, `shares`, `exact`).

**Expense ↔ transfer is a conversion, not an edit.** They are different
entities — an `Expense` row and a `Settlement` row — so Save tombstones the
one and creates the other, in the same append (`convertToSettlement` /
`convertToExpense`, `commands/entries.ts`); a partial write must never leave
the money recorded as neither. The draft doesn't know or care which pair of
kinds it's crossing: `entryTable` (`lib/draft.ts`) is the one fact that says
whether the id it was opened on still names what `kind` is now, and both the
save path and the split's rounding seed (`splitSeed`) read it to decide
whether they're still looking at the same entity.

**Each split tab holds its own input** (`SplitInputs`, `lib/draft.ts`). One
`SplitSpec` converted on every switch made the tabs edit each other: leaving
somebody out of Evenly deleted the parts they had under As parts, and As
amounts would only let you type for whoever Evenly had ticked. A tab opened for
the first time is handed what is on screen, once — "even, then nudge one
person" is why — and keeps what was typed into it after that. `percent` stays
in `SplitSpec` readable but unwritable: removing the variant would break the
one thing the op log promises, and it has no tab, so the first tap converts one
away for good.

## Consequences

- **No migration.** An expense written before any of this folds and renders
  identically; ops carry `kind` only on an income.
- `Expense.split` is still one spec: the tab showing when you press Save is the
  one written, and the other three are the draft's alone.
- `BalanceReport` gains `totalIncomeMinor`, `receivedMinor` and
  `incomeShareMinor`. Income is **never netted into** `totalSpendMinor` — what a
  trip cost and what it took in are different questions.
- Every term a balance is made of is **named** in the report, transfers
  (`settledMinor`) included: `byMember` = paid − owed − received + income share
  + settled. A screen showing some of the terms beside the balance can only be
  honest if the whole identity is available to it.
- Expense ↔ income is an edit of one field. Expense ↔ transfer is offered too,
  but costs a delete-and-add under the hood rather than an in-place edit — see
  above.
- A payer need not be a participant — paying for a dinner you weren't at is the
  point — so balances credit payers and debit participants independently. They
  still sum to zero; `payers.test.ts` asserts it over randomised groups.
- `resolvePayers` never throws on a spec that doesn't add up: a half-written row
  from some future client must not stop the balances screen rendering.
  `validatePayers` is where a bad spec is refused, before it is saved.

## Rejected

- **A separate `income` entity, or a negative `amountMinor`** — the first
  duplicates `payers`, `split`, `receiptItems` and every validation in core for
  two things that differ by a sign; the second spreads that sign across every
  piece of split and payer arithmetic, all of which assumes a positive total.
- **Renaming the `settlement` entity to `transfer`** — honest, and it would
  invalidate every op already on a log for a word no user ever sees.
- **Replacing `paidBy` with a payer-side `SplitSpec`** — nobody pays "30% of the
  bill", they hand over a number the receipt knows.
- **Storing payer amounts in base currency** — 400 MAD is what happened; storing
  €36,72 bakes a rounding decision into the record and can never be shown back
  unchanged.
- **Splitting a co-paid bill into several single-payer entries** — two rows for
  one dinner is a lie about the world, and it breaks the moment someone edits
  the amount.
