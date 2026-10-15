# Browser checks: the forms

*For: anyone fixing or extending the checks on the forms: entries reaching the
commands, and a form under a phone keyboard. Part of the [browser
checks](browser-checks.md) docs, which say how to write one that holds.*

## `pnpm verify entries` — the form is wired to the commands

The command tests prove an income's sign reaches the balances and that a
transfer edit writes only what changed. They cannot prove the *form* reaches
those commands — a Save stuck disabled, a segmented control writing the wrong
field, a detail screen that can't find a settlement by id
([ADR-0010](decisions/0010-what-an-entry-is.md)). This adds each of the
three kinds through the real UI, edits them, and reads the history back. It
also drives an entry's own rate end to end with no feed behind it — a new
currency opening the dialog by itself, the two directions of the field moving
together, the next entry borrowing the group's last rate without asking, and
correcting one entry's rate from its screen moving that entry and no other
([ADR-0005](decisions/0005-money-and-currency.md)). And it presses Save twice
from the keyboard, since a `click()` waits for a settled screen in between and
so cannot reproduce a double write. It holds rows with real touch, too, since a right
click is not what an iPhone sends: a hold opens one menu that its own lifting
click and Android's `contextmenu` leave open, and a tap, a scroll, a tap just
after and Enter all still navigate. The held finger then **slides onto an item
without lifting** and is answered, which is the gesture the browser reads as a
scroll and drops on the floor; a finger that only drifts chooses nothing. And a
menu item is tapped **without a click** — pointer and touch events dispatched
by hand, because that is the tap iOS sometimes sends and Chromium never does
([touch-and-viewport.md](touch-and-viewport.md#a-touch-is-not-a-click)) — while a lift that slides off the item
first still chooses nothing. Then the tap every *other* phone sends, whole,
which asks **where that tap's own `mousedown` landed** rather than whether the
dialog it opened survived: a dialog's card is centred, so a menu halfway down
the screen drops the stray press harmlessly on the card and would hide the bug.

A tap on the Record card's figure is read back off the clipboard, which must
hold the bare number ([import-export.md](import-export.md#the-clipboard)).
It also opens the two screens that carry the in-memory draft with no draft to
carry — which is what a reload, a restored tab or a kept link is — and holds
them to going back to the ledger rather than waiting for one that is never
coming, and opens all four of the form's screens on a group this phone hasn't
got. `pnpm rules` already fails a `/g` page that renders no `BadLink`; a grep
cannot see whether an unknown id *reaches* that branch or the blank frame
beside it ([navigation.md](navigation.md#routing)).

**Wait on state, not on a URL:** a save navigates before Dexie has redrawn, so
every assertion here follows a `waitForFunction` on the row count. Skipping
that is what makes a check like this flake.

## `pnpm verify keyboard` — a form under a phone keyboard

Four screens ask for people in the same add row (`components/name-adder.tsx`), and each ends on the act those
people are for — Create, "Continue as …", the scan pair, "Change who you are" —
docked under the scroller (`.whodock`), which pays the keyboard's strip as its
own padding ([touch-and-viewport.md](touch-and-viewport.md#the-screen-and-the-keyboard-over-it)).
Lose that padding, or put the act back inside the scroller, and the button sits
under the keys on a phone nobody in this repo is holding.

There is no keyboard in a headless browser, so one is faked where the app reads
it — `visualViewport.height` — and everything after that is the app's own:
`gapOf` calls the gap a keyboard, `--kb` is paid, and the scroll is the one
`components/viewport.tsx` makes. The assertion is what a thumb cares about, the
field *and* the act still above the top of the keys. The list is ten people
deep on every screen on purpose: three fit above a keyboard whatever the scroll
does, and a check that passes with the fix deleted is worse than none — with
the dock's `--kb` padding gone, all five assertions fail.

The confirm key is the other half, and it needs no faking — a headless browser
presses Enter like any other. It walks the columns the fix is really for,
the split editor's "as amounts" and "as parts" and `/g/payers`, one press per person down a
column of ten, and asserts what a thumb would notice: every row reached, each
one once, and the last of them folding the keyboard rather than wrapping round
to the top. The two assertions that keep the chains apart are the other ones
worth having — the entry form's note folds rather than diving into the column
underneath, and the add row, which is a `<form>`, still files the name and
hands the caret back ([entry.md](entry.md#the-keyboards-chain)).
