# 0005 — Per-expense currency with a rate locked at entry

**Status:** Accepted · 2026-08-27

## Context

The main use for an app like this is a trip abroad: some expenses in the local
currency, some at home, one group. Three models were on the table — single
currency per group, per-expense currency with a frozen rate, or live re-rating
of everything against current rates.

## Decision

A group has a **base currency**. Each expense stores its own `currency`,
`amountMinor`, the `rateToBase` in force when it was entered, and the resulting
`baseAmountMinor`. Balances are computed in the base currency.

The rate is fetched at entry time, shown to the user, and **editable** — if you
know the card actually charged you a different rate, you can say so.

## Consequences

- Handles the real case: 620 MAD for dinner, €580 for the riad, one balance.
- **Your debt doesn't change while you sleep.** A settled balance stays settled.
- The original amount is retained and displayed under the converted one, so a
  figure is always checkable against the physical receipt.
- Rate fetching needs a source. Offline entry defaults to the last cached rate
  for that pair, flagged so the user can correct it — never blocks the write.
- Two expenses in the same currency on the same day may carry slightly different
  rates. This is correct (it's what the bank did) but must not look like a bug —
  the rate is shown on the expense detail.
- Settling up across currencies is out of scope: settlements record a real
  transfer with its own currency and rate, same as an expense.

## Rejected

- **Single currency per group** — simplest, but the schema migration to add
  currency later touches every expense ever written, and trips abroad are the
  primary use case.
- **Live re-rating** — sounds more "correct", is actively confusing. A debt that
  drifts overnight is a debt nobody can settle.
