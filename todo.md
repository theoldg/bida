# TODO

## Release

### Self-hosting instructions

### Other cleanups
Check for secrets, license, data disclaimer, other?

### Admin panel?

### Assess privacy
**Answered, and the answer is bad:** ops land in D1 as plain JSON. The group
secret is only a bearer token, stored as a SHA-256 hash (`apps/api/src/auth.ts`,
`store.ts`), so anyone with database access reads every title, amount, name and
note. Decide: say so plainly in the disclaimer, or encrypt the op payload under
a key derived from the link secret. The second is the biggest piece of work
left in the project — see the note at the foot of this file.

## UI

### Expense rows
- Expense rows have inconsistent height (a foreign entry carries an extra line)
- The subtitle now shortens rather than overflowing (see
  [Subtitles](#subtitles--done-2026-09-11)), but the question underneath is
  still open: does the line earn its place at all, at full width?
- Drop the vertical red/green bars for expense rows (`.row.up/.down::before`)

### Receipt items foldable summary
Something is off here idk

## Features

### Quick split
Help me design a "quick split" mode which allows splitting a receipt straight from the home screen, without creating a group.
1. "Quick split"
2. Input members
3. Scan or upload receipt
4. Select items
5. Summary with export link
Open Qs:
- disregard currency?
- how are results exported? Text summary? Image with itemized subtotals? Both?

### Entry search and sorting
Maybe?

### Support discounts and tax in receipts

## UX improvements

### Expense editor density
Half done: the kind is one chip rather than three buttons, the date sits above
the split, and everything that can be wrong stays quiet until Save is pressed.
Two cuts proposed and **not** decided — fold "Multi-payer" into the payer
dialog, and take "Receipt" out of the split's tab bar now `/g/scan` exists.

### Who had what
- Include non-translated mode
- Language choice should reflect on the expense summary outside of edit mode

## Copy/text etc

### ~~Commas~~ — done 2026-09-11
Amount fields have grouped with U+202F since 2026-08-28; the gap left was the
*rate*, typed and printed as one digit string ("1 EUR = 13000 UZS"). The
component's caret-and-grouping half is `GroupedInput` now, the rate field is
one, and printed rates go through `rateText`. Nothing in the app shows an
ungrouped figure.

### ~~Subtitles~~ — done 2026-09-11
`FitLine` renders the longest of several wordings that fits, measured on a
canvas. The order — mode, then share count, then the payer's co-payers
abbreviated but never dropped — is `lib/row-meta.ts`, and it is the part to
argue with. At 390px a four-way receipt split with a long name now loses the
mode instead of half a word.

## Engineering

### ~~Measure the log's growth~~ — done 2026-09-11, and it found receipts
Whole-entity ops cost 2.55x, which is fine. But an expense op carrying
`receiptItems` is 2,016 bytes against a plain one's 473, and those are 74% of
every patch byte in production — editing a scanned bill's title repeats the
whole item array. Nothing to do at 676 kB of a 500 MB limit; if it ever matters,
the fix is one rule (drop superseded `receiptItems` from folded-past ops).
Numbers in [docs/implementation-status.md](docs/implementation-status.md).

### End-to-end encryption (the hard one)
See [Assess privacy](#assess-privacy). Encrypting op payloads under a key
derived from the link secret keeps the server honest, but it costs the server
every ability that depends on reading content, needs a migration for groups
already in D1, and has to survive a link shared by someone who then changes
nothing. An ADR before a line of code.
