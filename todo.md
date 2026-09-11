# TODO

## Release

### Self-hosting instructions

### Other cleanups
Check for secrets, license, data disclaimer, other?

### Admin panel?

### Assess privacy
Do i have access to the entire database, or is it encrypted with the group secret?

## UI

Rebrand to "bida" and use the logo when i get it from Max

### Expense rows
- Expense rows have inconsistent height (currency makes them taller)
- Remove the "from receipt" subtext for expenses (takes up too much space + info spam) - actually is the subtitle necessary at all? Let's rethink it
- Drop the vertical red/green bars for expense rows

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
Too many buttons in expense editor mode? Think. Maybe entry type and split mode should be foldout/popover.

### Scan flow
Let's redesign the receipt scanning flow. You don't need to fill the title or total, but it seems like you do - amount input jumps out at you with an open keyboard... Maybe there should be a second button next to the "add expense" [+] for adding a receipt directly without having to deal with that

### Who had what
- Include non-translated mode
- Language choice should reflect on the expense summary outside of edit mode

## Copy/text etc

### Commas
All amounts everywhere should always be formatted with comma separated thousands. Currently missing from some places.

### Subtitles
Some row subtitles are too long and overflow e.g. "name + 1 other paid, 5 people, from receipt". It's always better to drop some of this info rather than overflow. Figure out how to avoid this (define an order of that to drop and measure if it fits?)
