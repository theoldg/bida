# 0015 — One money field; core reports numbers, screens write sentences

**Status:** Accepted · 2026-08-28

**Context.** The owner: *"the amounts number input is really awkward to use,
there's no caret and i have no idea what's going on. fix that and all similar
components"* and *"the text 'X minor units unallocated' should be displayed in
currency."*

Two complaints, one shape: money was handled by whichever screen happened to
hold it. Five money fields had each rolled their own, two of them round-trip
controlled inputs (`value={bare(parseMinor(text))}`) that parsed and reformatted
on every keystroke — so React rewrote the value, the caret snapped to the end, a
half-typed "12." was erased by its own formatter, and tapping into the middle of
a figure appended at the end. `blankDraft` seeded `amountText: "0"`, a real
character: tap in, type 5, get "50". And none of them looked like inputs.

The second complaint is the same failure a layer down: `validateSplit` and
`validatePayers` returned a ready-made sentence containing a raw minor figure —
"230 minor units unallocated" — because `packages/core` is currency-agnostic by
design and had no way to format it. So it formatted it wrong, and every screen
printed that.

## Decision

- **One component owns every money field**: `components/amount-input.tsx`.
  `AmountInput` is text-valued; `MinorAmountInput` wraps it for fields whose
  model is minor units, keeping the typed text local and emitting a number.
  `sanitizeAmount` and `groupDigits` are exported and unit-tested. No screen
  sanitises money itself.
- **The caret is preserved explicitly**: a `useLayoutEffect` counts significant
  characters (digits and the point) before the caret and puts it back after
  reformatting. Backspace over a group mark deletes the digit before it.
- **The group separator is U+202F**, a narrow no-break space — the field accepts
  both "," and "." as decimal separators, so neither can also mean "group".
- **A money field looks like a field**: `.amountfield`'s underline, brand on
  focus, red when invalid; `blankDraft` starts empty with a muted placeholder.
- **Core reports a code and a number, never a sentence with money in it.**
  `SplitValidation` and `PayerValidation` carry `problem` and `diffMinor`;
  `message` stays, currency- and figure-free, for problems that aren't about an
  amount. The screen builds the sentence with `shortfallText` in
  `lib/format.ts`, because only it knows the currency.

## Consequences

- Every money field gains the same caret behaviour, sanitising, affordance and
  keyboard by construction. Getting a new one wrong now requires effort.
- `packages/core` keeps its promise of knowing nothing about currency display,
  and stops leaking "minor units" into the interface. Two tests assert it never
  puts a bare number in a sentence a human reads.
- A typed figure groups with U+202F while a saved one groups the way the locale
  does, so it looks slightly different while you type. Accepted: the alternative
  is an ambiguous parse or no grouping at all, and input correctness beats
  output consistency here.
- In *as amounts* mode a split row no longer prints a per-row figure under the
  field — the field is the figure, and `resolveSplit` throws while the split is
  short, which had been rendering a confident "€0.00" beside a typed "40.00".

## Rejected

- **Keep the round-trip and patch the caret per screen** — the same
  `useLayoutEffect` copied five times, drifting immediately. The duplication was
  the bug.
- **A masked-input library** — a dependency for a twenty-line spec whose edge
  cases (zero-exponent currencies, two separators, a trailing point) are ours.
- **Give core the currency so it can write the sentence** — formatting wearing a
  validation hat; core would then need the wording too, which differs per screen.
- **Format the shortfall at each call site** — four sites, four chances to print
  minor units again.
