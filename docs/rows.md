# Rows

*For: anyone drawing a row — on the ledger, the groups list, Balances — or
what a row says about you. Part of the [design system](design-system.md).*

## Your own rows are highlighted

Always, not as a mode ([ADR-0007](decisions/0007-a-screen-is-a-route.md)). A row
that is about you takes a translucent neutral wash laid *over* the list, plus a
left-edge bar so it survives colour-blindness; the same wash marks pending sync,
both meaning "this is about you, not the shared record". Neutral rather than
tinted, so a row's own green or red stays the only colour on the line — and the
*only* way you are marked, since a member is always printed by name, never
replaced by "You".

**The split and the payers take the pair apart.** There the question on the
screen is who is in, so the wash marks every row that is in the split or put
money in (`.inrow`), and you are marked by "(you)" after your name (`You`, as on
the entry), with no bar — as are the form's Paid by, its payer lines (no tint
for yours) and the bill's per-person lines under Items.

**The split's foot row is a count and a box, right-aligned** (`.splithead`):
"**3** of 4" beside a drawn checkbox — ink with a tick for everyone, ink with
a dash for some, an empty outline for nobody — sitting in the rows' 16px mark
column, so it foots the ticks, the parts' plus and the figures above it. No
wash and an empty left half, so it is never read as one more person — and only
the box is tappable: a 36px target around it, with the press darkening the box alone.

**The wash eats soft hairlines.** A `--rule-soft` line is invisible against it,
so wherever a washed row abuts something — the row below it, or the split
editor's mode tabs above it — that boundary is redrawn at 14% ink or it reads as
one merged block.

**Not on the ledger.** There nearly every entry is one of yours, so a wash on
each would mark nothing: ledger rows are the plain rows of the groups list. What they did to your balance is said on the figure — `+€45,00`
green, `−€14,28` red: what you put in for that entry minus what you owe for it
(`entryEffect` in core, which is `computeBalances` run on that entry alone),
changing rendering only, never data — and the exception is what the list marks: a row you are
no part of drops to 58% opacity rather than disappearing. Balances' suggested
reimbursements do the same, under rows that do wear the bar: a bar there
would say "you" about a payment, and they end in the ledger card's chevron.

**On an entry, your name carries "you" and the screen ends in your balance.** A
small, faint `(you)` follows your name wherever the entry prints it: the one
payer on the paid-by line, a payer row, a split row. A transfer gets neither;
its two names and an arrow already say it. The rows themselves stay uncoloured. Under the split, unless you neither paid nor had
a share, is the ledger row's figure, signed and coloured as it is there:
`Your balance +CRD 40.00`. When two of the card's numbers made it, it opens
folded to that figure, a chevron after the label as on your bill's row, and
unfolds to the sum written out as at school: "you paid 50.00", "your share
− 20.00", the result under a rule (`entryEffect`'s up and down — an income's
share comes first, since it is what moved you up). Always one figure under the other, digits
aligned whichever side the locale puts the code; the result moves down into
the sum rather than being printed twice. Opened under the fold line, it glides up until
all of it shows, and shut, glides back to where it was opened from — never a
jump, the docked Edit sliding with the list's foot — as each bill on the split card and Balances' "How are these worked
out?" do (`useFold`).

**The column adds up to the net on the balance card** above the list — words
over figure, the figure sized to its own length in CSS alone (`.mysum`), so a
seven-digit sum shrinks rather than runs under the chevron. **A changed figure
rolls** (`components/rolling-figure.tsx`): each digit that changed slides one
line, up for a bigger figure and down for a smaller, 800ms apiece and 100ms
apart from the left; the rest never move. One trigger covers a save, a sync and
a reopen — the card keeps the net it last drew per group in localStorage
(`lib/roll.ts`, erased with the group) and rolls from it, a beat after
mounting; a group's first view, and reduced motion, just show the figure. The
card's words and colour keep the old sign until the figure sets off, then fade
over the roll, so a settle-up greys as it rolls to zero.

## The ledger moves

The ledger changes under somebody looking at it in three ways, and each has
one motion (`components/ledger-rows.tsx`, the arithmetic in
`lib/ledger-motion.ts`). The list is flat: a date line is an item of its own,
not a heading riding on its day's first row, so it can stay while a row beside
it comes or goes. Every row draws the line under it — transparent above a date
line, whose band is its own edge, and under the last row.

- **A save lands on its row.** The form hands the ledger the entry it wrote
  (`markSaved`); the row wears a wash from its first frame — `--ink` at 13%, a
  shade over `--press` — and after a beat longer than the you-owe card's
  (`SAVED_BEAT`, 600ms), so the screen has plainly arrived first,
  from wherever the ledger was put back to ([navigation.md](navigation.md)),
  is brought whole into the strip above the floating buttons, date line
  included when it heads its day, only as far as it has to and not at all if
  it already shows — unless, with the list at its very top, the row would sit
  in the top half of the screen: then the list goes to the top, so the banner
  shows the change beside the row, and its figure holds its roll until the
  list is there (`awaitRoll`). The wash lets go over 0.9s — at once if nothing
  moved, and `SAVED_DWELL` (600ms) after landing if the list scrolled, since
  the eye arrives with the scroll; a held roll waits with it. A colour
  settling, so exempt from the motion clamp.
- **A row that goes** fades (140ms), then its space folds (220ms). The divider
  under it is the line above the row beneath, so it stays, rides up on that
  row and lands on the line above — two lines closing into one. A date line
  left with no rows folds in the same motion, after the row's blank space:
  it reads whole for as long as there is room for it. The last row takes no
  motion: it is gone and the empty state is up at once — too rare to earn one.
- **A row that arrives** from another phone opens a gap (220ms) and fades in
  (180ms), at the slot's opacity so a dimmed row fades to its own 58% and not
  past it. No flash: the history clock's dot already says it came. **Above what
  you are reading, it grows the list upward instead** — the view is held by
  hand, nothing under your eye moves, and nothing animates. A list moving
  under a finger or still gliding takes no change until 300ms after it stops.
  Into an empty ledger (a first pull), rows just appear.

Under reduced motion the movement is instant and only the wash still plays.
The groups list is the same list: a forgotten group folds out like a deleted
entry, the last one included in the no-motion rule; a group that turns up just
appears.

## A row says less rather than being cut off

An expense row's second line is the payer and a head count, "Alice +1 · 👥5",
plus an income's tag; the split mode is the entry's own screen's to say. The
name is never dropped and takes the ellipsis; the "+1" for co-payers and the
tag stay beside it, since leaving either out would be untrue; the head count is
what a long name pushes out. That needs no measuring — the count's box shrinks
first and wraps it onto a clipped second line. Lines with more than two facts use
`FitLine`, which takes several wordings longest first and renders the longest
that measures under the box (`lib/row-meta.ts` owns the order). A group list
row's line is that ladder with a fixed bold lead: "N new changes" is never
dropped, then people go, then entries, and the time is last standing — the lead and the time
say whether to open the group, the counts only what is in it.

A ledger row is always the same height, whether or not it carries a second
figure — the sum as it was spent, before the group's currency. The row is held
to the height of the three-figure case and its column is centred in it
(`.entryrow`, and `.grouprow`/`.skelrow` with it, so a row is a row on every
screen): a two-figure row takes the slack as air above and below. The amount
column is leaded tight so that height stays close to a two-line row's.

`FitLine` (`components/fit-line.tsx`) measures each wording on a canvas in a
layout effect, so the pick is made before paint and the text and the box never
argue; `lib/fit.ts` is the measuring (`fitIndex`, pure and tested) and
`lib/row-meta.ts` the editorial order, which is the part worth arguing about.
With nothing to measure yet — no canvas, no layout — it renders the longest
rung, so the static export ships the full line and the browser narrows it. A
`lead` rides ahead of every rung, and the rungs fit in the width it leaves.
Every fit re-measures on resize and when the web font lands, through one
`useRefit`.
## An arrow points one way, and an income says so twice

A settle row is a *thing to do* — "you pay Marie €12" — not a statement that two
people are connected, so never a double-headed arrow. A transfer's row is
titled the same way, "Marie → Bob", not "Marie paid Bob". `i-arrow` always points payer → payee, left to right, matching
the names beside it; on the transfer form (`.transfer`) it sits between the two
sides and *pressing it reverses them*, because backwards is the mistake that
control exists to make cheap — so there it is an inked square, a control, and on
the detail screen a bare glyph on the card. Each side is labelled above the name, so "From" is
read before the person it qualifies.

Which way an entry runs is the one distinction with no colour left to spend on
it, so an income ends its row's second line with an **"income"** tag — the
`--hl` wash of the form's "from receipt", no dot before it, the wash being
separation enough — and prints a `−` on its ledger figure
([ADR-0010](decisions/0010-what-an-entry-is.md)). Two signals, never one.

## Gotchas

- **A height moved frame by frame re-lays out every row under it.** On a
  300-entry ledger at 4× CPU each frame of a fold cost ~85ms of layout.
  `content-visibility: auto` on the slots made it one long frame, but
  off-screen rows then report a placeholder height to the scroll compensation,
  so it is not on.
- **`.row:last-child` sees wrappers, not lists.** A div around each ledger row
  made every row a last child: two rows on one day had no line between them for
  months.
- **A later `border-bottom` shorthand undoes a state's colour.** `.splitrow`
  sits below `.inrow` in `globals.css` and reset its divider, so rows in the
  split merged into one wash; `.splitrow.inrow` restates it.
- **Back from a save, the ledger draws the old net for a frame** — its live
  query answers before the write lands. So a save's roll is usually a change
  arriving while the card is mounted, not one read from `bida.shown`; a check
  waiting for `.rolling` must wait for it, not look once.
