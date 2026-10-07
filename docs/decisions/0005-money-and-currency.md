# 0005 — Money: minor units, each entry's own rate, one field that types it

**Status:** Accepted · 2026-08-27 · revised 2026-09-04 (the rate moved from the
entry to the group) · revised 2026-10-07 (and back to the entry, fetched for
its day)

**Context.** The main use is a trip abroad: some expenses local, some at home,
one group. Three models were on the table — one currency per group, per-expense
currency with a frozen rate, or live re-rating. We shipped the frozen rate, typed
by hand; then a group-wide registry, so a wrong number was fixed once; then the
owner moved the rate back onto the entry (2026-10-07), because what a
currency is worth is a fact *about the day the money was spent*, and a feed
can state it without anybody typing. Separately, money was being handled by
whichever screen held it: *"the amounts number input is really awkward to use,
there's no caret"*, and *"'X minor units unallocated' should be displayed in
currency"*.

## Decision

**A group has a base currency; every entry carries its own currency and rate**
(`rateToBase`, foreign to base, frozen at save) and where the rate came from
(`rateSource`: `fetched`, `typed`, `copied`, or `group` for the old registry's).
What an entry is worth is its amount at its own rate, re-derived on read
(`atCurrentRates`), so nothing written later moves it.

**The rate is fetched, not typed.** The form asks our endpoint
(`GET /api/rates/:from/:to?date=`, in the Worker, so the feed is swappable and
cacheable at the edge) for the rate **on the entry's own day** whenever its
currency or day changes, or a scan lands — never again on an entry merely
opened to edit, and a day change leaves a typed rate alone. When the feed can't
answer, the entry keeps the rate it already had for that currency, else borrows
the group's most recent entry in it (`latestRate`). **Only a currency new to the
group, with the feed out of reach, opens the rate dialog.** The rate rides on
the entry, so nothing is written until Save.

**A rate is edited in whichever direction you think in** — 1 EUR = 4.5 PLN or
1 PLN = 0.22 EUR — two fields for one number, each derived from the other, in
the dialog the entry form's rate chip and the entry screen's both open.
Correcting a rate from the entry's screen is an edit of that entry and nothing
else. Rates are exact decimal strings, stored to 12 significant digits and shown
to 6 (5 on a chip), which is what makes the round trip through the inverse land
back on what you typed.

**The registry is retired, not erased.** Its `rate` ops stay in production logs
and still fold; no screen writes one. An entry written while it was live has no
`rateSource` and is read at the registry's rate, until `entriesCarryTheirOwnRate`
writes that rate onto it — the repair a group's first sync of the session runs —
so the move changed no balance ([invariants.md](../invariants.md)).

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

Amounts are integer minor units everywhere and always positive.

## Consequences

- Handles the real case: 620 MAD for dinner, €580 for the riad, one balance,
  each figure at the rate of its own day, and no number typed at all.
- **A settled balance stays settled.** Nothing re-values history; a wrong rate
  is fixed on the entry that carries it.
- The original amount is retained and displayed under the converted one, so a
  figure is checkable against the physical receipt.
- An offline trip still works: the group's last rate in the currency is a good
  guess, and the rare entry in a new currency asks.

## Rejected

- **Single currency per group** — simplest, but adding currency later touches
  every expense ever written, and trips abroad are the primary use case.
- **A rate registry per group** — what we shipped from 2026-09-04: one place to
  fix a number, but a fix re-valued every balance in the group, a settled trip
  could move under you, and a rate always had to be typed or confirmed. Owner's
  call, 2026-10-07: the rate is the entry's, fetched for its day.
- **A device-local rate cache** — then two phones show two different totals for
  the same trip and neither is wrong, which is the failure this app exists to
  avoid. The rate is on the entry, so it syncs with it.
- **Asking whenever the feed fails** — a trip spent offline would open a dialog
  on every entry; the group's last rate is nearly always the answer.
- **A masked-input library** — a dependency for a twenty-line spec whose edge
  cases (zero-exponent currencies, two separators, a trailing point) are ours.
- **Give core the currency so it can write the sentence** — formatting wearing a
  validation hat; core would then need the wording too, which differs per screen.
