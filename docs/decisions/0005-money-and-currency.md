# 0005 — Money: minor units, a rate locked at entry, one field that types it

**Status:** Accepted · 2026-08-27 · input 2026-08-28

**Context.** The main use is a trip abroad: some expenses local, some at home,
one group. Three models were on the table — one currency per group, per-expense
currency with a frozen rate, or live re-rating. Separately, money was being
handled by whichever screen held it: *"the amounts number input is really
awkward to use, there's no caret"*, and *"'X minor units unallocated' should be
displayed in currency"*.

## Decision

**A group has a base currency; each expense carries its own.** An expense stores
`currency`, `amountMinor`, the `rateToBase` in force when it was entered, and
the resulting `baseAmountMinor`. Balances are computed in base. The rate is
fetched at entry, shown, and **editable** — if the card charged a different
rate, you can say so. Amounts are integer minor units everywhere and always
positive.

**One component owns every money field**: `components/amount-input.tsx`
(`AmountInput` text-valued, `MinorAmountInput` wrapping it where the model is
minor units). The caret is preserved explicitly — a `useLayoutEffect` counts
significant characters before it and puts it back after reformatting — because
five hand-rolled fields had each round-tripped through a formatter on every
keystroke, erasing a half-typed "12." and snapping the caret to the end. It
groups with U+202F, since the field accepts both "," and "." as decimal
separators and neither can also mean "group"
([design-system.md](../design-system.md#a-money-field-has-an-underline)).

**Core reports a code and a number, never a sentence with money in it.**
`SplitValidation` and `PayerValidation` carry `problem` and `diffMinor`; the
screen builds the sentence (`lib/format.ts`), because only it knows the
currency. `packages/core` must not leak "minor units" into an interface.

## Consequences

- Handles the real case: 620 MAD for dinner, €580 for the riad, one balance.
- **Your debt doesn't change while you sleep.** A settled balance stays settled.
- The original amount is retained and displayed under the converted one, so a
  figure is checkable against the physical receipt.
- Two same-currency expenses on one day may carry slightly different rates.
  That's correct — it's what the bank did — so the rate is shown on the detail.
- Offline entry defaults to the last cached rate for the pair, flagged for
  correction. It never blocks the write.

## Rejected

- **Single currency per group** — simplest, but adding currency later touches
  every expense ever written, and trips abroad are the primary use case.
- **Live re-rating** — sounds more "correct", is actively confusing. A debt that
  drifts overnight is a debt nobody can settle.
- **A masked-input library** — a dependency for a twenty-line spec whose edge
  cases (zero-exponent currencies, two separators, a trailing point) are ours.
- **Give core the currency so it can write the sentence** — formatting wearing a
  validation hat; core would then need the wording too, which differs per screen.
