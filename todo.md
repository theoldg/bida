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

### Save conditions
Conditions for saving are too eagerly red, and don't work for unfilled amounts/titles. Need to redesign hinting what's missing (highlight missing element on attempted save?)

### Scan flow
Let's redesign the receipt scanning flow. You don't need to fill the title or total, but it seems like you do - amount input jumps out at you with an open keyboard... Maybe there should be a second button next to the "add expense" [+] for adding a receipt directly without having to deal with that

### Who paid
"Who paid" is clunky
- the trigger is not aesthetic (think)
- inside the editor the [+] next to someone's name is not clickable while the empty space next to it is.
- once clicked, it should focus the amount field and pull up the keyboard

### Who had what
- Include non-translated mode
- Language choice should reflect on the expense summary outside of edit mode

## Copy/text etc

### Commas
All amounts everywhere should always be formatted with comma separated thousands. Currently missing from some places.

### Subtitles
Some row subtitles are too long and overflow e.g. "name + 1 other paid, 5 people, from receipt". It's always better to drop some of this info rather than overflow. Figure out how to avoid this (define an order of that to drop and measure if it fits?)

## Refactor

### Receipt / "as parts" intertwined
Definitively decouple receipt splitting mode from "as parts", there's been tons of bugs and counter intuitive behaviours everywhere - currently in history text. They don't have anything to do with each other from a user perspective, they should be decoupled in the code. Refactor as much as you need.
