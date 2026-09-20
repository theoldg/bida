# Design system

*For: anyone writing something a person will look at.*

**`apps/web/app/globals.css` is the source of truth**, not this document — its
`:root` block is the canonical palette in all three theme states. Take values
from there; never re-pick one by eye. This file explains the reasoning so you
extend the design rather than diverge from it.

## Direction

A terminal: one monospace face, near-monochrome grounds, hairline rules, square
corners. Colour is a scarce resource spent only on money —
[ADR-0023](decisions/0023-monospace-monochrome.md). The ledger reading survives
underneath: ruled rows, a red column and a green column.

**The app names itself once**, on the groups list: *bida* — lower-case always
— with one kebab opposite holding the light/dark switch and "About bida"
as words, and nothing under it; a sub-line would caption the list you are already looking at. Every
other top bar says the thing you opened, so a second name would be branding
where a title should be. **The mark is not in the app**: `design/brand/logo.svg`
is the home-screen icon `pnpm icons` rasterises, and in the bar it sat beside a
three-letter name that did not need illustrating. If it ever comes back it
comes back as that file in an `<img>`, never redrawn in `--brand` to make it
theme-aware — that was tried, and a tracing of a logo is a worse logo.

The screen behind the info glyph (`/about`) is the app's only prose: a measured column (`.about`, ~34em, centred in the shell — `/advanced` and `/install` wear it too), each claim under a
monospace eyebrow in `--ink-2` — the `.daylabel` register, which is how this app
already writes a heading that is not a title. No cards there; a box per
paragraph makes a settings list out of something read once, top to bottom. One
exception earns it: the stored row under Privacy takes a card ground and a size
step down (`.aboutrow`) because every word on the screen is already monospace
and a typeface can't mark it. The receipt-scan line leads that same section
instead — an exception said before the rule it is an exception to, not buried
under it — set apart by nothing but its own bold lead-in (`strong`).

## Palette roles

| Token | Role |
|---|---|
| `--paper`, `--card`, `--card-2/3` | Grounds. Near-neutral greys, both themes |
| `--ink`, `--ink-2`, `--muted` | Text, three levels |
| `--rule`, `--rule-soft` | Hairlines — the ruling |
| `--brand` | **Equal to `--ink`.** Buttons, active tabs, the focus ring |
| `--credit` / `--debit` | **The only two hues in the app.** Money owed to you / by you |
| `--hl`, `--hl-edge`, `--hl-ink` | A neutral wash: your own rows, and pending sync |
| `--press` | The wash under a thumb. Composited, not a background |
| `--press-i` | The same wash for a control that is already ink: the primary button, the FAB |
| `--draw-bg`, `--draw-rule`, `--draw-ink` | The scan screen's drawing, and only that. Palette values in light; lifted off them in dark, where a picture has to sit further from its ground than text does |
| `--draw-paper` | The bill half of that drawing, which has no outline to hold its shape. Darker than the ground in light, lighter in dark — white paper on a near-white ground is a receipt that vanishes, teeth and all |

Two hues, and they mean one thing each. A "Save" button is not a credit, so
never colour a control with `--credit`; and because `--brand` is just ink, a
primary button is figure-ground inversion — an ink block with a paper glyph.
Adding a third hue is a regression. A person is identified by their printed
name and nothing else — no tint, and no initials square
([ADR-0023](decisions/0023-monospace-monochrome.md)). **The one sanctioned exception:**
destructive actions (`.btn-d`, "Remove") take `--debit` as an outline, not
a fill — losing that warning to consistency would be a worse trade. With hue
spent, **size is the emphasis left**: a screen whose one act ends it gives that
act the full width of the screen at `.btn-lg` — taller and heavier, still square
and still flat. It is the last row of the scroll, not a pinned bar: pinned, it
fights the phone keyboard, which overlays the shell rather than shortening it.
Where the screen has no scroll of its own to ride — the who-had-what grid owns
its, sideways as well as down — the button sits in the fixed foot, and that
band pays `--kb` in its place. The entry form, the new-group form, the
who-had-what grid and "Which one are you?" all end this way. `/g/scan` is the
one exception: it holds a picture and the button that picture explains, and at
the foot the button is a long way from the only thing explaining it, so the two
sit centred as one block instead.

**Two jobs are two figures, and the ledger says that shape twice.** The ledger
floats an ink "+" with the outlined scan FAB beside it — two equal
destinations, one of which is still the primary
([ADR-0023](decisions/0023-monospace-monochrome.md): the "+" is the screen's
only figure-ground inversion, and a second would spend that twice). The groups
list ends in the same pair grown up (`.starttile`): two squares below the list
rather than two rows in it — neither is a group, and the ghost row's dashed
square marks a slot in the list they left — big enough to stack a word under
the icon, capped so a square doesn’t become a 170px tile, and centred with the
FAB pair's own gap between them — near enough to read as one pair, with the
margin around it doing the separating. "New group" is the inked one and takes
the right, where a thumb rests, with "Quick split" outlined beside it — and, on an iOS home-screen app only,
"Paste link" outlined on the far left ([frontend.md](frontend.md#one-navigation)). The
pair is sticky (`.homepair`), floating over the list once there are enough
groups to scroll — ungrounded, as the FABs it echoes are, so two figures pass
over the rows rather than a dock cutting the screen in two; they never go out
of reach either.

**Balances has a corner of its own.** The ledger's two never appear there — it
is a reading, not a place you add to — so the tip jar takes the spot
(`.fab-w`, [product.md](product.md#the-mvp)). It wears the scan FAB's outline,
never the ink, which this screen spends on the numbers, and it is the only FAB
that carries a word: "+" and a camera are guessable, an ask is not. Wider than
it is tall, so the shape says it is a different kind of thing before the word
is read.

**One act with three doors is one button cut in three.** Reading a bill starts at
the camera, at the library or at a box you type it into, and which of those is a
detail of the same job — two doors only on `/g/scan`, reached by pressing a
camera, where a box to write in is not what the picture above it promised: `.btn-pair` is one bordered box with hairlines between
the doors, the box owning the border as in `.splitbox`. Buttons side by side is
the shape for *different* jobs, and `.seg` is the app's mode switch — under the split
editor's tabs it would read "which of these am I in". Mid-scan the divider goes
and the box holds one strip, "Reading…", with the press wash sweeping across it
over the three seconds a scan usually takes — the one wait in the app whose
length we can guess, so it is drawn rather than shrugged at. The bar *is* the
control filling, not a track inside it, and it hands over to the spinner only
if the model is slower than usual; an answer that beats it never shows one.
Three registers, so where it sits changes its size and almost nothing else:
an ink block where the screen exists for it (`/g/scan`) and on the Items tab,
where it is likewise the only thing to do, and chip scale — on paper, so it
doesn't outweigh what it replaces — to replace a bill already assigned. Each door
names itself ("Scan", "Upload", "Type"); the screen around them
has already named the job. Where the doors share a width the words are what has
to fit, so the chip register — content-sized, being `inline-flex` — is the one
that says "Type it in" in full, the same way it says "Rescan" for "Scan" — and on `/g/scan` and `/quick` it draws what it
promises, since that result lands on another screen: a bill of four lines and a
total, the arrow, and the expense that comes back split by that bill between
three of the people splitting it. One drawing on both screens
(`components/scan-diagram.tsx`) — the app's one picture, and it is built out of the
interface it explains rather than of illustration — the same square card, the
same label-and-number rows, the same hairline under a total, at half the type
size on `--draw-*`. The bill is the one exception, and deliberately so: it is
torn off top and bottom and has no outline or radius at all, because a square
card is exactly what it would otherwise be mistaken for — the form beside it.
Each half is as wide as half the control beneath it, so the three line up; the sentence the picture replaced is its `alt`; and the shares
are summed from the lines on the left (`lib/scan/diagram.ts`), never typed, so
the two halves can't drift apart. Each screen gives it its own
line: `/g/scan` centres the pair, `/quick` wears it as a head over the list of
who is splitting — with the space around the pair, not inside it — and the
names in it are that list.

**Dark is not the light palette turned down** — the owner's call, against a
first pass that was green and yellow. Grounds are near-neutral in both
themes (`#0E0F11`, `#141517`, `#1A1C1F` dark), and `--credit`/`--debit` keep
their hues — they're semantic and must not drift. Both dark blocks
(`prefers-color-scheme` and `[data-theme="dark"]`) carry identical values.
Change one, change the other.

## Your own rows are highlighted

Always, not as a mode ([ADR-0007](decisions/0007-a-screen-is-a-route.md)). A row
that is about you takes a translucent neutral wash laid *over* the list, plus a
left-edge bar so it survives colour-blindness; the same wash marks pending sync,
both meaning "this is about you, not the shared record". Neutral rather than
tinted, so a row's own green or red stays the only colour on the line — and the
*only* way you are marked, since a member is always printed by name, never as
"You".

**The wash eats soft hairlines.** A `--rule-soft` line is invisible against it,
so wherever a washed row abuts something — the row below it, or the split
editor's mode tabs above it — that boundary is redrawn at 14% ink or it reads as
one merged block.

**Not on the ledger.** There nearly every entry is one of yours, so a wash on
each lit the whole screen and marked nothing: ledger rows are the plain rows of
the groups list. What they did to your balance is said on the figure — `+€45,00`
green, `−€14,28` red — and the exception is what the list marks: a row you are
no part of drops to 58% opacity rather than disappearing.

## Nothing waits in silence

A screen that hasn't repainted yet and a screen that didn't hear you look
identical. Two states cover the gap, and neither is a spinner:

- **Press.** `--press` on `:active`, as a `linear-gradient` rather than a
  `background-color` so it composites over what the control already sits on.
  Instant down, `.2s` up; nothing moves and nothing scales. An inverted control
  — the primary button, the FAB — takes `--press-i` instead: ink washed over
  ink is a tint nobody can see, and a big Save that doesn't answer the thumb
  reads as a dead button. The tint fills the control, not the column of text
  inside it: a press inset from the row it sits in reads as a misaligned box
  rather than as an answer (`.billgroup > button.kv`). The browser's own
  tap highlight is off (late, and it disagrees), with `touch-action:
  manipulation` to drop the 300ms double-tap wait.
- **Waiting.** A list still coming out of Dexie draws `SkeletonRows`: same row
  height, same three columns, pulsing, staggered — arrival changes the text and
  not the layout. The frame around it is real and tappable.
- **A tick, where neither of those reaches.** `lib/haptics.ts` — one 8ms
  vibration, and the only one the app has. It is spent on the two answers that
  land away from the thumb: a long press deciding it was a hold, where the menu
  opens above the finger and there is no wash under it, and a link reaching the
  clipboard, where the check is a glyph in a top bar or in a menu that has
  already closed. A tap with a press wash under it needs nothing added, and iOS
  has no such API at all — so it is an addition to a screen that already reads
  without it, never the thing that says an action worked. Off under
  `prefers-reduced-motion`.

## Type

**One face: JetBrains Mono**, 400–700, loaded once by `next/font` and
self-hosted. `--f-display` and `--f-body` are aliases of `--f-mono`, kept so the
CSS still speaks in roles. Hierarchy is weight and tracking, with size the last
step: headings 700 at `-.03em` — and a screen whose own title carries it rather
than the bar (`.question`) sets that title above the bar's 17px, centred — body
400/500 at 14px, labels and eyebrows uppercase at `.12em`.

Money keeps `.num` — `font-variant-numeric: tabular-nums` — so decimal points
align down a column even though everything is already monospaced. Body sets
wider than a proportional face did, so titles truncate a word earlier: accepted.

## A money field has an underline

Every field you type an amount into is the same component wearing
`.amountfield`: an inline-flex wrapper with a bottom rule that is `--rule` at
rest, `--brand` on `:focus-within`, and `--debit` (rule *and* text) when the
figure doesn't add up. The big one on the entry form adds a thicker rule, a
small radius and a `--card-2` well while focused. Disabled fields drop the rule
to transparent rather than showing a dead one. Digits group with **U+202F**
while typing; saved figures group the way `Intl` does — deliberately different
([ADR-0005](decisions/0005-money-and-currency.md)). **No
amount is ever shown in minor units.** The exchange-rate field is one of these
too: "1 EUR = 18 000 UZS" is a rate people type, so it groups, and `rateText`
groups the ones we print. **The field settles when you leave it**: it holds the
text you typed while you are typing it — caret and half-finished "1." intact —
and pads it to the currency's fraction on blur, so a finished "5" doesn't sit
in a column of "12.00"s looking like a different kind of number.

## A row says less rather than being cut off

A ledger row's second line is a stack of facts — who paid, how many ways, in
what mode — and a long name pushes it past the width of a phone. `ellipsis`
cuts at the end, so the line loses whatever happened to be *last* rather than
whatever mattered *least*. `FitLine` takes several wordings of the line,
longest first, and renders the longest that measures under the box. Two rules
set the order, and they live with the copy in `lib/row-meta.ts`: **shortening
must not lie** (co-payers get abbreviated, "Alice +1 paid", never dropped), and
**drop what the entry's own screen says better** — the split mode first, the
share count next, the payer never. `.rmeta` keeps its ellipsis for the last
rung, because a name can be any length at all.

A ledger row is always the same height, whether or not it carries a second
figure — the sum as it was spent, before the group's currency. A row that grew a
line for that one broke the rhythm of the list wherever one landed, so the row
is held to the height of the three-figure case and its column is centred in it
(`.entryrow`, and `.grouprow`/`.skelrow` with it, so a row is a row on every
screen): a two-figure row keeps the sum and your share together and takes
the slack as air above and below. The amount column is leaded tighter than it
was, so that fixed height stays close to the old two-line row's and the ledger
holds as many entries per screen.

## The bar is furniture

Every top bar is the same height on every screen, whatever anyone typed into
the app. A `.topbar` title clamps at two lines — what a 40-character group name
takes at 17px — and its sub-line at one, because every sub-line in the app is a
caption on the title above it (a name, a date, a figure) and a caption running
to a second line is the thing it captions, in the wrong place. A `capped`
title, which has a centred control to end before, stops at one too. Growing the
bar instead is what this looked like before, and a bar grown to six lines
leaves its own back arrow and bin floating in the middle of a paragraph.

Text with more to say than that says it **in the screen**. `/g/entry`'s head is
the entry's own title, with the figure under it and the bar left holding only
the kind and the date, both bounded. The title's size is measured rather than
set (`FitTitle`, on `lib/fit.ts` like `.rmeta`'s wording ladder): it takes the
largest step that says the words in one line and falls to the wrapping size
when none does, so "Dinner" is a heading and a sentence is a paragraph. Nothing
on that ladder reaches the amount's 32px — the money still leads, and it keeps
the same left margin as the title, since a figure pushed to the other edge
strands the short ones.

## An arrow points one way, and an income says so twice

A settle row is a *thing to do* — "you pay Marie €12" — not a statement that two
people are connected, which is what the double-headed swap arrow said.
`i-arrow` always points payer → payee, left to right, matching
the names beside it; on the transfer form (`.transfer`) it sits between the two
sides and *pressing it reverses them*, because backwards is the mistake that
control exists to make cheap — so there it is an inked square, a control, and on
the detail screen a bare glyph on the card. Each side is labelled above the name, so "From" is
read before the person it qualifies.

Which way an entry runs is the one distinction with no colour left to spend on
it, so an income says **"received"** in its row and prints a `+` on its figure
([ADR-0010](decisions/0010-what-an-entry-is.md)). Two signals, never one.

## A dialog is ours, and its button says the act

Asking is never `prompt()` or `confirm()`: those arrive in another app's
typeface, announcing that the *site* is asking, with one line where a consequence
needs a paragraph. `components/dialog.tsx` is a real `<dialog>` — `showModal()`,
so focus and Escape are the platform's — filling the viewport and painting the
scrim itself. Inside: a hairline card, `Cancel` beside an act that names itself
("Forget group", never "OK"), `--debit` outlined when it destroys something. A
screen still wins where the decision needs the ledger on it — the payers editor,
who-had-what ([ADR-0008](decisions/0008-hand-rolled-interface.md)). Nor is a `<select>` ours, and
there are none left: `ChoiceDialog` picks from a short list in the app's own
rows — a name, a check on the current one, and a `note` saying what an
unobvious pick does. A date is the exception, being a calendar and not a list
([ADR-0008](decisions/0008-hand-rolled-interface.md)). A *failure* is not
a dialog at all — there is nothing to decide — so it is said under whatever was
attempted, in `--debit`: `Failure` / `.failure`. **A held action always says
why**: Save greyed with nothing to read is a dead end, so the entry form keeps
a single reason line beside the payer field rather than one per branch — but a
line is not the only way to say it, and where the fix is a control on screen
the control blooms and the sentence goes.

A *refused* action points instead of explaining: a Save that can't go through
blooms whatever stopped it `--debit` and lets it settle back over ~600ms —
**whole, ground included**. A missing figure blooms its field: the title's box
fills like an ink block, its label and whatever is written in it riding along
in `--brand-ink`, and the amount takes a red plate under its figure and the
rule it is typed on. The label goes with the fill because it is the word that
says *which* field was refused. A missing *step* blooms the whole control that takes it, edge, label,
icons and any rule inside it: the scan pair and the door to the who-had-what
grid, which is the Items tab's entire complaint now that the red sentence
under it is gone. Both of those are ink blocks, so both fill (below). Pointing beats wording there, because "scan a receipt" was
true of every untouched bill and read as a scolding for arriving. Where what is missing is spread over
several rows, every one of them blooms: a Done on the who-had-what grid points
at each line nobody has been given — the whole row, right across the columns of
dots, since most of a row is empty space and the two lines of text at its left
end were a refusal you had to be looking for. That one washes rather than
fills, because the dots and the ×N have to stay legible through it; its words
still go `--debit` on top. This is how you find the line again in twenty rows
of bill. **A refusal nobody can see whole is a press that
did nothing**, so unless one of those rows is fully in view — a name with its
amount cut off by the fold is not — the nearest is brought into the grid
smoothly first and the flash runs when it lands (`lib/reveal.ts`, `lib/seek.ts`);
one already wholly in view moves nothing, because a list that jumps under
somebody looking at the answer is worse than one that sits still. The entry
form does the same on its own scroll — with the keyboard up, Save and an empty
amount are a screen apart — and blooms only what is still missing when it lands.
The button itself never goes red — it is the
control that was pressed, not what is missing — it only greys for the length of
the flash and any travel before it, like Save. A number that
is not on the form at all blooms the way *to* it and loses its sentence for the
same reason: a foreign entry whose currency the group has no rate for points at
its "set rate" badge. **A control fills whole**,
ground and border together, rather than colouring its label: that badge, 11px
on a wash, the two ink blocks — the who-had-what door and the scan pair — and
a field, which has an edge and was the quieter for using it: a red line around
unchanged grey writing is the smallest signal in the app for the biggest thing
it has to say. A label alone is smaller still, and a `--brand` or `--rule-soft`
frame left around a red block reads as half a refusal. The
add row's plus fills for the same reason — what Create and a quick split's scan
pair point at over a name nobody has filed is 15px of glyph in a 32px box, far
too little ink to be seen going red, so the ground goes instead. **A refusal
blooms what has to change**, and on that row that is the plus only while a good
name is waiting to be pressed in; when the field is the problem the field
blooms in text instead — the placeholder when a screen refuses over a list too
short to go on with, the typed name when the list already holds it, since no
press files that one. A press of the plus on an empty row refuses nothing at
all: it takes the caret, which is the whole answer. And a keystroke ends any
flash there on the spot, rather than reddening writing that is being typed over
(`name-adder.tsx`). A flash
rather than a held red, and it replays on every refusal — the two identical
`-a`/`-b` animations in `globals.css` are the restart mechanism. Save is spent
for exactly as long as the flash — greyed instantly, eased back — which is the
press saying it landed, and stops the same press arriving again over a form
mid-way through saying no. The bloom is a jump in *contrast* and not only in
hue (`--debit` is far darker than `--rule` on paper and far lighter in the
dark), so it survives being unable to tell red from grey. It is the one thing
exempt from the global reduced-motion clamp: a colour settling is what that
guidance asks you to fall back *to*, and clamped it would be nothing at all.

**Not every flash is a refusal.** Where a tap is answered by the screen
rearranging itself — tapping a folded run of portions on the who-had-what grid
opens it — the tapped column is faint from the first frame those rows are
painted, holds that way while they are scrolled into view whole, and is
released once they have stopped moving, each dot easing back to what it really
is. **The column meets in the middle**: assigned and empty cells alike sit at
one faint ink, so what an opened run shows first is the places an answer could
go. The empty ones carry a dot because that is what is being shown, and the
pointer has to be the shape of one; the assigned ones fade rather than darken
because `--ink-2` has nowhere darker to go. **A pointer starts held, not
animated** — rows painted at full strength and dimmed a beat later flicker, and
nothing can ease into a row that did not exist a frame ago. Never `--debit`:
nothing is wrong and nothing is being asked for.
The same `-a`/`-b` pair restarts it, and it is exempt from the motion clamp on
the same grounds. A cell that cannot be tapped like its neighbours doesn't look
like them either — a run handed out unevenly wears the dot **broken into two
overlapping squares** on everyone who had any of it, so no cell in that row
reads as an ordinary assignment.

## Rules that are not negotiable

1. **Colour is never the only signal**, and is never spent on anything but
   money. Debit and credit carry a sign *and* a word *and* a bar direction;
   pending sync carries a dot *and* a banner.
2. **Both themes are designed.** Tokens on bare `:root` (light), redefined under
   `@media (prefers-color-scheme: dark)` guarded with `:root:not([data-theme=
   "light"])`, and again under `:root[data-theme="dark"]`. Never declare a
   colour only inside a media or `[data-theme]` block.
3. **Foreign currency keeps its original figure** under the converted one. The
   receipt says 620 MAD; so must the app.
4. **Rounding is silent.** The leftover minor unit rotates deterministically and
   is never rendered —
   [standing-instructions](standing-instructions.md#product).
5. **`100dvh`, safe-area insets, thumb-reachable primary actions.** People use
   this standing up in a restaurant.
6. **The app is not a document: nothing selects, the browser never gets a long
   press, no zoom.** `user-select: none` on `body`, `.selectable` to opt back
   in; `NoLongPress` swallows the touch context menu, except on a row that
   opts into the app's own small `RowMenu` instead, on a touch hold or a right
   click (`useHold` in `components/long-press.tsx`, `components/row-menu.tsx`).
   The hold's own finger may slide onto an item and let go rather than lift
   and tap again, as it may in the menus the phone draws itself. A top bar
   whose actions outgrow it opens that same card from a button instead
   (`MenuButton`), so the app has one menu and not two.
   Inputs exempt from both. Zoom needs all
   three of `userScalable: false`, `touch-action: pan-x pan-y` on `html, body`
   and `NoPinchZoom` — no one of them covers every browser, and desktop zoom is
   left alone.

## Gotchas

- Something wrong on "the app" rather than one screen is a shell bug: look at
  `.app` / `.appbody` / `.scroll` in `globals.css` first, and check the fix on a
  screen that overflows.
- iOS Safari in a tab ignores `user-scalable=no` and lets `touch-action` stop
  only double-tap; `preventDefault` on `gesturestart` is what holds the scale.
- No shadcn/ui dependency exists, and no component library's variable names sit
  between the tokens and the app.
  [ADR-0008](decisions/0008-hand-rolled-interface.md). No CSS framework either:
  the reset at the head of `globals.css` is every browser default the screens
  were written against, so an element nothing renders yet — `<small>`,
  `<summary>`, `<optgroup>` — arrives with its own defaults intact.
- **`color-mix` is used unguarded** and nothing generates a fallback for it any
  more, which puts the floor at Safari 16.2 and Chrome 111. Four values want it
  (`--hl-row`, `.mine`, `.btn-pair`, the dialog scrim); a browser below that
  draws each one flat, and the scrim opaque.
- **`animationend` bubbles.** `.btn-pair` listens for the refusal flash on the
  way up, so anything else that animates inside it — the scan's own sweep, the
  who-had-what grid's pointer inside a bloomed row — has to stop the event, or
  a flash that never ran reads as one that settled.
- **A `::placeholder` cannot be animated.** Blink drops any animation declared
  on one: the rule parses, the class lands, nothing happens. Three refusals
  were dead on arrival that way for months, visible in no test — a
  `getComputedStyle(el, "::placeholder")` mid-flash is what says so. What works
  is animating the *input* and mixing the placeholder from `currentColor`, so
  the faint word rides the ink that can move (`globals.css`, "save refusal").
- **An animation taken off mid-flight reports nothing.** The refusal class is
  conditional on what is wrong, so fixing it *during* the flash removes the
  class and no `animationend` ever fires — and a control spent for the length
  of one stays spent for good. Whatever put the flash there has to notice the
  fix arriving early and end the refusal by hand (`refusal.onFlashEnd()` with
  no event). It has cost a locked Save on the who-had-what grid and a locked
  add row before it (`lib/refusal.ts`).
- **Two flex children that both claim the full width are not equal halves.**
  The overflow is shared out in proportion to what is *inside* each one, so a
  child with different padding or a border takes a different half: swapping a
  dialog's act for the `ScanBusy` strip snapped the row to 170/182 and read as
  the button resizing under the thumb. A row of equal halves is `.drow`'s
  `grid-auto-columns: minmax(0, 1fr)`, which doesn't care what is in them.
- **`table-layout: auto` makes every column a function of every cell.** The
  browser measures the content and works backwards, so a table that grows a
  suffix, swaps a button or indents one row re-measures the lot: opening a run
  on the who-had-what grid moved the name column 3px and every dot after it.
  A table whose shape changes under the reader declares its widths in a
  `<colgroup>` and takes `table-layout: fixed`. It also has to carry a
  `min-width`, or the columns are squashed below the size of what is inside
  them rather than overflowing the scroller.
- **A sticky cell needs an opaque background, and a row-state selector will
  steal it.** `tr.part td` is more specific than the `.itemlabel` that set the
  card behind the frozen name column, so it replaced that base with the
  translucent band — which then painted *twice* down the names and once across
  the cells: one row, two greys. A cell that other cells scroll under has to
  restate its background colour wherever a row state sets one.
- **`width: 100%` inside a scroll container is the *visible* width**, not the
  scrollWidth — a block child's containing block is the scroller's content box.
  That is what lets prose share a scroller with a table wider than the screen:
  `width: 100%` plus `position: sticky; left: 0` is one screenful, pinned,
  costing the horizontal scroll nothing. A sentence in a `colSpan` cell gets no
  such thing, and wraps at the table's width with half of itself off to the
  right.
- **One global stylesheet means a bare class name lands everywhere it is
  spelled.** `.billline.tip` was compounded and still took the tip jar's `.tip`
  — a centred flex column with 22px of gap — so every discount and tax line in
  a person's bill stacked its label over its figure with a band of air around
  it. The compound selector wins the properties it sets and nothing more.
  Prefix a modifier with its block (`billextra`) rather than naming it after
  what it holds.
- **A grid row holds as many items as it has children, and text counts once.**
  `.warnlist li` is `auto 1fr` — icon, sentence — so the `/about` warning whose
  sentence links to the tip jar handed it three items: the link became column
  one of a second row and the last words broke away under the icon. Text with
  an inline element in it goes into the row as one `<span>`.
- **`money()` is locale-dependent, so a hand-written symbol beside it drifts.**
  `Intl` renders USD as "US$1.25" anywhere but en-US, which put a `US$` share
  under the tip jar's hand-set `$5`. Dollars quoted in copy get `usd()`
  (`lib/format.ts`), pinned to en-US; the group's own money stays the reader's.
