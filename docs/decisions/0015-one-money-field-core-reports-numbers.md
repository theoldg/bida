# 0015 — One money field; core reports numbers, screens write sentences

**Status:** Accepted · 2026-08-28

## Context

The owner, 2026-08-28:

> "the amounts number input is really awkward to use, there's no caret and i
> have no idea what's going on. fix that and all similar components."
>
> "the text 'X minor units unallocated' should be displayed in currency (2.30
> eur unallocated) or something"

Two complaints with one shape: money was being handled by whichever screen
happened to hold it.

There were four money fields — the expense amount, the FX rate, a split row in
*as amounts* mode, a payer's contribution, plus the settle-up amount — and each
one had rolled its own. Two of them were *round-trip* controlled inputs:
`value={bare(parseMinor(text))}`, so every keystroke was parsed to minor units
and reformatted back. That is what "no idea what's going on" was. React rewrites
the value, the caret snaps to the end, a half-typed "12." is erased by its own
formatter, and a field you tapped into the middle of appends at the end anyway.
The expense field had a third bug on top: `blankDraft` seeded `amountText: "0"`
so the borderless figure showed *something*, but that zero is a real character —
tap in, type 5, get "50". And none of them looked like inputs: no underline, no
focus state, nothing to say a tap would land.

The second complaint is the same failure one layer down. `validateSplit` and
`validatePayers` returned a ready-made English sentence containing a raw minor
figure — "230 minor units unallocated" — because `packages/core` is
currency-agnostic by design and had no way to format it. So it formatted it
wrong, and every screen printed that.

## Decision

- **One component owns every money field**: `components/amount-input.tsx`.
  `AmountInput` is the text-valued one (the draft's `amountText`, the settle-up
  figure); `MinorAmountInput` wraps it for the fields whose model is minor units
  (split rows, payer contributions), keeping the typed text local and emitting
  a number. `sanitizeAmount` and `groupDigits` are exported and unit-tested;
  no screen sanitises money itself any more.
- **The caret is preserved explicitly.** The value shown is grouped for reading
  (`1 234.50`), so reformatting moves characters; a `useLayoutEffect` counts the
  significant characters (digits and the point) before the caret and puts it
  back where the user left it. Backspace over a group mark deletes the digit
  before it, not the space.
- **The group separator is U+202F**, a narrow no-break space. The field accepts
  both "," and "." as the decimal separator, so neither can also mean "group" —
  any other choice makes a typed figure ambiguous on parse.
- **A money field looks like a field.** `.amountfield` is a wrapper span with an
  underline that turns brand-coloured on focus and red when invalid; the big
  expense figure gets a thicker rule and a tinted well. `blankDraft` starts
  empty with a muted "0" placeholder.
- **Core reports a code and a number, never a sentence with money in it.**
  `SplitValidation` and `PayerValidation` carry `problem` (`"empty" | "under" |
  "over" | …`) and `diffMinor`. `message` stays, currency-free and figure-free,
  as a fallback for the cases that aren't about an amount. The screen — which
  knows the currency — builds the sentence with `shortfallText` in
  `lib/format.ts`: "€15.00 left to split", "€2.30 still unaccounted for".

## Consequences

- Every money field in the app gains the same caret behaviour, the same
  sanitising, the same affordance, and the same keyboard, by construction. A new
  one is `<AmountInput>`; getting it wrong now requires effort.
- `packages/core` keeps its promise of knowing nothing about currency display,
  and stops leaking "minor units" into the interface. Anything reading `message`
  for an amount problem gets a figure-free sentence — read `problem` and
  `diffMinor` instead. Two tests assert core never puts a bare number in a
  sentence a human will read.
- The typed field groups with U+202F while `formatMinor` groups the way the
  locale does ("€13,456.50"). A figure therefore looks slightly different while
  you are typing it than once it is saved. Accepted: the alternative is either
  an ambiguous parse or no grouping at all while typing, and the field is the
  one place where correctness of *input* beats consistency of *output*.
- In *as amounts* mode a split row no longer prints a per-row figure under the
  field — the field is the figure, and `resolveSplit` throws while the split is
  short, which was rendering a confident "€0.00" beside a typed "40.00".

## Rejected alternatives

- **Keep the round-trip and patch the caret in each screen.** The same
  `useLayoutEffect` copied five times, drifting immediately. The duplication was
  the bug.
- **A masked-input library.** A dependency, for something whose whole spec is
  twenty lines and whose edge cases (zero-exponent currencies, two decimal
  separators, a trailing point) are ours, not a library's defaults. See
  [ADR-0008](0008-hand-rolled-css-not-shadcn.md).
- **Give core the currency so it can write the sentence.** That is a formatting
  concern wearing a validation hat; core would then also need the wording, and
  the wording differs per screen ("left to split" vs "still unaccounted for").
- **Format the shortfall at the call site each time.** Four call sites, four
  chances to print minor units again. `shortfallText` is one.
