# 0005 — Per-expense currency with a rate locked at entry

**Status:** Accepted · 2026-08-27

**Context.** The main use is a trip abroad: some expenses local, some at home,
one group. Three models were on the table — one currency per group, per-expense
currency with a frozen rate, or live re-rating.

**Decision.** A group has a **base currency**. Each expense stores its own
`currency`, `amountMinor`, the `rateToBase` in force when it was entered, and
the resulting `baseAmountMinor`. Balances are computed in base. The rate is
fetched at entry, shown, and **editable** — if the card charged a different rate,
you can say so.

## Consequences

- Handles the real case: 620 MAD for dinner, €580 for the riad, one balance.
- **Your debt doesn't change while you sleep.** A settled balance stays settled.
- The original amount is retained and displayed under the converted one, so a
  figure is always checkable against the physical receipt.
- Rate fetching needs a source. Offline entry defaults to the last cached rate
  for the pair, flagged for correction — it never blocks the write.
- Two same-currency expenses on the same day may carry slightly different rates.
  That's correct (it's what the bank did) but mustn't look like a bug, so the
  rate is shown on the expense detail.
- Settling across currencies is out of scope: a settlement records a real
  transfer with its own currency and rate, like an expense.

## Rejected

- **Single currency per group** — simplest, but adding currency later touches
  every expense ever written, and trips abroad are the primary use case.
- **Live re-rating** — sounds more "correct", is actively confusing. A debt that
  drifts overnight is a debt nobody can settle.
