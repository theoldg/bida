# 0005 — Money: minor units, one rate per currency per group, one field that types it

**Status:** Accepted · 2026-08-27 · revised 2026-09-04 (the rate moved from the
entry to the group)

**Context.** The main use is a trip abroad: some expenses local, some at home,
one group. Three models were on the table — one currency per group, per-expense
currency with a frozen rate, or live re-rating. We shipped the frozen rate,
and what it cost was not drift: **one fact — what a MAD is worth to this
group — was scattered across every entry that used it**, so a wrong number
could only be repaired entry by entry, and no screen could show them together.
The owner revised the design on 2026-09-04. Separately, money was being
handled by whichever screen held it: *"the amounts number input is really
awkward to use, there's no caret"*, and *"'X minor units unallocated' should be
displayed in currency"*.

## Decision

**A group has a base currency and a registry of rates — one row per other
currency it spends in.** The registry is the single source of truth for what a
foreign amount is worth, so an entry is *valued* at the rate in force now, not
at the rate that happened to be in force when somebody typed it. Correct the
rate and every entry in that currency moves with it, which is the repair the
frozen rate could not do.

**A rate is an op** (`entity: 'rate'`, `entityId` the currency code), so it
syncs, folds and shows up in history like any other change — the whole group
agrees on one number and can see who changed it and when. It carries `source`
(`fetched` or `typed`) and `asOf`, so a screen can say where the number came
from.

**Nothing is fetched behind your back and nothing is written without you.** The
rate dialog pulls a suggestion from our own endpoint (`GET /api/rates/:from/:to`
in the Worker, so the feed is swappable and cacheable at the edge), fills it in,
and waits: a number that moves every balance in the group gets an actor and a
line in the log. Offline, the dialog says so and stays typeable — the feed is a
convenience, never a gate. It opens by itself the first time a group meets a
currency, because a foreign entry with no rate is exactly the state that used
to bank 500 MAD as €500.

**A rate is edited in whichever direction you think in** — 1 EUR = 4.5 PLN or
1 PLN = 0.22 EUR — two fields for one number, each derived from the other.
Rates are exact decimal strings, stored to 12 significant digits and shown to 6,
which is what makes the round trip through the inverse land back on what you
typed.

**Entries still store `rateToBase` and `baseAmountMinor`.** They are no longer
what an entry is worth; they are the honest record of what was believed at the
time, and the fallback for a currency the registry has no row for — which is
every foreign entry in every group written before the registry existed. So the
upgrade needs no migration, and removing a rate row is not "the group has no
idea what MAD is worth", it is back to what each entry was saved with.

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

- Handles the real case: 620 MAD for dinner, €580 for the riad, one balance —
  and one place to fix the rate when the bank's differs from the feed's.
- **A balance can move under you.** Editing a rate re-values history on every
  phone; that is the point, and the dialog says how many entries it moves before
  you save. Nobody's *debt in the currency they owe it in* changes.
- Repricing is one pass (`core/rates.ts`, `atCurrentRates`) applied once where
  the app reads its state, not a lookup threaded through every call site — any
  site that forgot would misreport money silently.
- The original amount is retained and displayed under the converted one, so a
  figure is checkable against the physical receipt.
- A group can hold a rate for a currency it hasn't spent in yet, and the
  registry screen is where a currency is added ahead of the trip.

## Rejected

- **Single currency per group** — simplest, but adding currency later touches
  every expense ever written, and trips abroad are the primary use case.
- **A rate frozen onto each entry** — what we shipped first. It makes an entry
  self-contained and a settled balance permanent, and in practice it scattered
  one fact across every row that used it, so a typo could only be fixed entry by
  entry. Owner's call, 2026-09-04: the registry is live.
- **A device-local rate cache** — no ops, no sync, less to go wrong; but then
  two phones show two different totals for the same trip and neither is wrong,
  which is the failure this app exists to avoid.
- **Fetching on a schedule, or writing a fetched rate straight into the
  registry** — a poller that quietly restates everyone's balances overnight.
  One trigger, one dialog, one Save.
- **A masked-input library** — a dependency for a twenty-line spec whose edge
  cases (zero-exponent currencies, two separators, a trailing point) are ours.
- **Give core the currency so it can write the sentence** — formatting wearing a
  validation hat; core would then need the wording too, which differs per screen.
