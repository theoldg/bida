# 0010 — Co-sponsored expenses: `payers` beside `paidBy`, in the expense's own currency

**Status:** Accepted · 2026-08-27

## Context

The owner asked for expenses several people chip in on: *"Bob paid 400 and
Alice paid 100 for these 500 spent on people XYZ."* Until now `Expense.paidBy`
was a single member id, and `computeBalances` credited that one person the whole
`baseAmountMinor`.

Three shapes were on the table:

1. **Replace `paidBy` with a spec**, mirroring `SplitSpec`, with the same four
   modes on the payer side.
2. **Split one co-sponsored expense into several single-payer expenses** at
   entry time (Bob's 400 and Alice's 100 as two rows sharing a split).
3. **Add an optional `payers` map beside `paidBy`.**

## Decision

**Option 3.** `Expense.payers?: Record<Id, number> | null`, amounts in the
expense's **own currency**, summing to `amountMinor`. Absent means what it always
meant: `paidBy` paid all of it. Present, it wins, and `paidBy` is maintained as
the largest contributor.

`resolvePayers` (in `packages/core/src/payers.ts`) apportions the stored
`baseAmountMinor` across those contributions with the same seeded
largest-remainder distribution a `shares` split uses, so the payer side sums to
the base total exactly — the same guarantee the consumer side has always had.

## Why not the alternatives

**Not option 1** — replacing `paidBy` would rewrite the meaning of every op
already in every log and on the server, for a case that is rare. Percent and
shares modes make no sense on the payer side either: nobody pays "30% of the
bill", they hand over a number the receipt knows. One optional map, one mode.

**Not option 2** — two rows for one dinner is a lie about the world, and it
breaks the moment somebody edits the amount: which of the two synthetic rows
absorbs the change? It also doubles every co-sponsored expense in the history
timeline and the group total's row count.

## Why the expense's own currency, not base

People hand over what is on the receipt. 400 MAD and 100 MAD is what happened;
storing €36,72 and €9,18 bakes a rounding decision into the record, and can
never be shown back to anyone unchanged. Converting at read time also means a
corrected FX rate fixes the payer side and the consumer side together, which is
already how `baseAmountMinor` and `split` relate (ADR-0005).

## Consequences

- `paidBy` is still the field a list row, an avatar, and an older client read.
  It must be kept in step: the web command layer writes `primaryPayer(payers)`
  into it whenever `payers` is set.
- A payer need not be a participant — paying for a dinner you weren't at is the
  whole point — so balances credit payers and debit participants independently.
  They still sum to zero; `payers.test.ts` asserts it over randomised groups.
- `resolvePayers` never throws on a spec that doesn't add up. A half-written row
  from some future client must not stop the balances screen rendering; the
  weights get used as given and the base total still comes out exact. The
  editor's `validatePayers` is where a bad spec gets refused, before it is saved.
