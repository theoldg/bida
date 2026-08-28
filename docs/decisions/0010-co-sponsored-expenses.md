# 0010 — Co-sponsored expenses: `payers` beside `paidBy`, in the expense's own currency

**Status:** Accepted · 2026-08-27

**Context.** The owner asked for expenses several people chip in on: *"Bob paid
400 and Alice paid 100 for these 500 spent on people XYZ."* `Expense.paidBy` was
a single member id and `computeBalances` credited that person the whole
`baseAmountMinor`.

**Decision.** `Expense.payers?: Record<Id, number> | null`, amounts in the
expense's **own currency**, summing to `amountMinor`. Absent means what it always
meant. Present, it wins, and `paidBy` is maintained as the largest contributor.
`resolvePayers` (`core/payers.ts`) apportions the stored `baseAmountMinor` with
the same seeded largest-remainder distribution a `shares` split uses, so the
payer side sums to the base total exactly — the guarantee the consumer side has
always had.

## Why not the alternatives

- **Replace `paidBy` with a payer-side `SplitSpec`** — rewrites the meaning of
  every op already on every log, for a rare case. Percent and shares make no
  sense on the payer side either: nobody pays "30% of the bill", they hand over
  a number the receipt knows. One optional map, one mode.
- **Split it into several single-payer expenses at entry** — two rows for one
  dinner is a lie about the world, and it breaks the moment someone edits the
  amount (which synthetic row absorbs the change?). It also doubles the row
  count in history and the group total.
- **Store payer amounts in base currency** — people hand over what's on the
  receipt. 400 MAD and 100 MAD is what happened; storing €36,72 bakes a rounding
  decision into the record and can never be shown back unchanged. Converting at
  read time also means a corrected FX rate fixes both sides together, which is
  already how `baseAmountMinor` and `split` relate ([0005](0005-locked-fx-rate.md)).

## Consequences

- `paidBy` is still what a list row, an avatar and an older client read, so the
  command layer writes `primaryPayer(payers)` into it whenever `payers` is set.
- A payer need not be a participant — paying for a dinner you weren't at is the
  point — so balances credit payers and debit participants independently. They
  still sum to zero; `payers.test.ts` asserts it over randomised groups.
- `resolvePayers` never throws on a spec that doesn't add up: a half-written row
  from some future client must not stop the balances screen rendering.
  `validatePayers` is where a bad spec is refused, before it is saved.
