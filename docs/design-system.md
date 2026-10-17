# Design system

*For: anyone writing something a person will look at.*

**`apps/web/app/globals.css` is the source of truth**, not this document — its
`:root` block is the canonical palette in all three theme states. Take values
from there; never re-pick one by eye. This file explains the reasoning so you
extend the design rather than diverge from it.

**A mock for the owner to choose from is a page that inlines this whole file**
and uses the app's real classes (`.splitbox`, `.splitrow`, `.amountfield`…),
so its tokens and both themes are the app's to the pixel rather than copied by
hand. Make it work, not just look right, and photograph the shipped screen
beside it with `pnpm drive` ([drive.md](drive.md)).

| Read | When you are |
|---|---|
| **This file** | Choosing a colour, a size, a face, a press or a wait; laying out a screen's one act |
| [rows.md](rows.md) | Drawing a row: yours, the ledger's motion, a line that says less, an arrow |
| [entry.md](entry.md) | Laying out the entry form or the entry screen |
| [refusals.md](refusals.md) | Writing a dialog, a picker, or a button that can say no |
| [design-review.md](design-review.md) | Polishing a screen: open findings, and those ruled intended |

## Direction

A terminal: one monospace face, near-monochrome grounds, hairline rules, square
corners. Colour is a scarce resource spent only on money —
[ADR-0023](decisions/0023-monospace-monochrome.md). The ledger reading survives
underneath: ruled rows, a red column and a green column.

**The app names itself once**, on the groups list: *bida* — lower-case always
— with one kebab opposite holding Import, Settings and "About bida"
as words, and nothing under it; a sub-line would caption the list you are already looking at. Every
other top bar says the thing you opened, so a second name would be branding
where a title should be. **The mark is not in the app**: `design/brand/logo.svg`
is the home-screen icon `pnpm icons` rasterises. If it ever comes back it comes
back as that file in an `<img>`, never redrawn in `--brand` to make it
theme-aware — a tracing of a logo is a worse logo.

The screen behind the info glyph (`/about`) is the app's only prose: a measured column (`.about`, ~34em, centred in the shell — `/settings`, `/advanced` and `/install` wear it too), each claim under a
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
| `--paper`, `--card`, `--card-2/3` | Grounds. Near-neutral greys, both themes. The page itself is `--card`, so past 640px the column runs borderless into it |
| `--ink`, `--ink-2`, `--muted` | Text, three levels |
| `--rule`, `--rule-soft` | Hairlines — the ruling |
| `--brand` | **Equal to `--ink`.** Buttons, active tabs, the focus ring |
| `--credit` / `--debit` | **The only two hues in the app.** Money owed to you / by you |
| `--hl`, `--hl-edge`, `--hl-ink` | A neutral wash: your own rows, and pending sync |
| `--press` | The wash under a thumb, and half of it under a hovering mouse. Composited, not a background |
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
and still flat. Where a list of people can outgrow the screen — "Which one are
you?", `/g/payers`, the entry form and the entry it saves (History and Edit),
`/new`, `/quick`, People, the who-had-what grid — it is docked
(`.whodock`): beside the scroller rather than in it, which is only as tall as
its rows, so the button sits right under them while they fit and at the foot
of the screen once they don't. Outside the scroller, iOS's rubber-band never
carries it; it pays `--kb` itself, so it rides above the keyboard while one is
up. On `/g/payers` the verdict line rides in it with the button, and a Done
that doesn't add up flashes that line; the entry form and the grid say what is
wrong the same way, a red band over the button. On the entry screen a fold
opening above the dock slides it there on the fold's clock rather than jumping
(`slidingDock`, beside `useFold`) — only a fold: a save or a sync drawing the
entry anew puts it straight where it goes; the entry form's Save doesn't slide — nothing
folds there, and a slide after a tab switch read as lag. `/g/scan` is the
one exception: it holds a picture and the button that picture explains, and at
the foot the button is a long way from the only thing explaining it, so the two
sit centred as one block instead.

**Two jobs are two figures, and the ledger says that shape twice.** The ledger
floats an ink "+" with the outlined scan FAB beside it — two equal
destinations, one of which is still the primary
([ADR-0023](decisions/0023-monospace-monochrome.md): the "+" is the screen's
only figure-ground inversion, and a second would spend that twice). The groups
list ends in the same pair grown up (`.starttile`): two squares below the list
rather than two rows in it — neither is a group — big enough to stack a word under
the icon, capped so a square doesn’t become a 170px tile, and centred with the
FAB pair's own gap between them — near enough to read as one pair, with the
margin around it doing the separating. "New group" is the inked one and takes
the right, where a thumb rests, with "Quick split" outlined beside it — and, on an iOS home-screen app only,
"Paste link" outlined on the far left ([navigation.md](navigation.md#one-navigation)). The
pair is docked at the foot of the screen (`.homepair`), under the scroller
rather than in it, so a long list scrolls above it and never out of reach.

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
editor's tabs it would read "which of these am I in". (The split editor itself
hangs under `.splitrule`, a lone ÷ at half `--muted`, drawn square-dotted as in the logo:
without it the box read as one more field.) Mid-scan the divider goes
and the box holds one strip, "Reading…", with the press wash sweeping across it
over the three seconds a scan usually takes — the one wait in the app whose
length we can guess, so it is drawn rather than shrugged at. The bar *is* the
control filling, not a track inside it, and it hands over to the spinner only
if the model is slower than usual; an answer that beats it never shows one.
An import of fifty entries or more takes the same box in place of its
"Continue as", the wash standing at how much is written rather than sweeping
(`WriteBusy`) — a wait whose length is known, so it is counted, not guessed —
and so does a join of a group long enough to come in pages, where that button
will stand.
Three registers, so where it sits changes its size and almost nothing else:
an ink block where the screen exists for it (`/g/scan`) and on the Items tab,
where it is likewise the only thing to do, and chip scale — on paper, so it
doesn't outweigh what it replaces — to replace a bill already assigned; on
`/quick` back from the grid, full width but grey, under the ink way on. Each door
names itself ("Scan", "Upload", "Type"); the screen around them
has already named the job. Where the doors share a width the words are what has
to fit; the chip register — content-sized, being `inline-flex`, over a bill
already read — says "As text" for "Type", the same way it says "Rescan" for "Scan" — and on `/g/scan` and `/quick` it draws what it
promises, since that result lands on another screen: a bill of four lines and a
total, the arrow, and the expense that comes back split by that bill between
three of the people splitting it. One drawing on both screens
(`components/scan-diagram.tsx`) — the app's one picture, built out of the
interface it explains rather than of illustration — the same square card, the
same label-and-number rows, the same hairline under a total, at half the type
size on `--draw-*`. The bill is the one exception: torn off top and bottom with
no outline or radius, or it would be mistaken for the form beside it. Each half
is as wide as half the control beneath it, so the three line up; and the shares
are summed from the lines on the left (`lib/scan/diagram.ts`), never typed, so
the two halves can't drift apart. Each screen gives it its own
line: `/g/scan` centres the pair, `/quick` wears it as a head over the list of
who is splitting — with the space around the pair, not inside it — and the
names in it are that list.

**Dark is not the light palette turned down** — the owner's call. Grounds are near-neutral in both
themes (`#0E0F11`, `#141517`, `#1A1C1F` dark), and `--credit`/`--debit` keep
their hues — they're semantic and must not drift. Both dark blocks
(`prefers-color-scheme` and `[data-theme="dark"]`) carry identical values.
Change one, change the other.

## The bar is furniture

Every top bar is the same height on every screen, whatever anyone typed into
the app. A `.topbar` title clamps at two lines — what a 40-character group name
takes at 17px — and its sub-line at one, because every sub-line in the app is a
caption on the title above it (a name, a date, a figure) and a caption running
to a second line is the thing it captions, in the wrong place. A `capped`
title, which has a centred control to end before, stops at one too. A bar that
grows leaves its own back arrow and bin floating in the middle of a paragraph.

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
  rather than as an answer (`.billgroup > button.kv`). And the control is
  as big as what it sits in, so the wash is its hit area — and the hit area is
  what the eye takes for one thing: a `.pick` field answers on its label and
  padding too (a stretched `::after`), a quiet link on its words and never the
  empty line beside them (`.entryhist`). One exception: a
  who-had-what cell is hit anywhere between the rules, but washes only a 32px
  tile round its dot — rule to rule, a column read as one grey slab. The browser's own
  tap highlight is off (late, and it disagrees), with `touch-action:
  manipulation` to drop the 300ms double-tap wait.
- **Waiting.** A list still coming out of Dexie draws `SkeletonRows`: same row
  height, same three columns, pulsing, staggered — arrival changes the text and
  not the layout. The ledger's also holds the you-owe card (`SkeletonSummary`)
  and its date lines, or the rows land a card's height lower than they waited —
  a date line every third row, a guess, and mismatched it still reads fine. The
  ledger doesn't cut to itself: a copy of its skeleton is laid over it and
  dissolves in 120ms (`SkeletonVeil`), balance and all — if the skeleton was up
  for 100ms. Shorter, it cuts: a fade would stretch a flash nobody saw into a
  wait. The frame around it is real and tappable.
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

**One face: JetBrains Mono**, 400–700, a variable font committed under
`public/fonts/` with its `@font-face` rules at the head of `globals.css`. A
character outside Google's subsets falls back to the phone's font, which is
how "→" once came out small and low: it has its own file now, the face's
"->" ligature drawn onto →, so the text stays a real arrow. `--f-display` and `--f-body` are aliases of `--f-mono`, kept so the
CSS still speaks in roles. Hierarchy is weight and tracking, with size the last
step: headings 700 at `-.03em` — and a screen whose own title carries it rather
than the bar (`.question`) sets that title above the bar's 17px, centred — body
400/500 at 14px, labels and eyebrows uppercase at `.12em`.

Money keeps `.num` — `font-variant-numeric: tabular-nums` — so decimal points
align down a column even though everything is already monospaced. Monospace
sets wide, so titles truncate a word earlier: accepted.

## A money field has an underline

Every field you type an amount into is the same component wearing
`.amountfield`: an inline-flex wrapper with a bottom rule that is ink at 40% at
rest (translucent, so it reads on a row's wash as on the card), `--brand` on `:focus-within`, and `--debit` (rule *and* text) when the
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

## Rules that are not negotiable

1. **Colour is never the only signal**, and is never spent on anything but
   money. Debit and credit carry a sign *and* a word *and* a bar direction —
   the sign only where no word sits right above the figure, so the ledger's net
   card ("You owe") prints no minus; pending sync carries a dot *and* a banner.
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
   (`MenuButton`), so the app has one menu and not two. The card is drawn for a
   thumb: ~48px rows under a 14.5px label, parted by a `--rule-soft` hairline so
   six actions read as six rather than as a block. The row says it can be
   held: under a touch its wash deepens over the hold's 500ms, and while its
   menu is open — and the question an item asks, a delete's — it rises 1.5% on
   a `--hl` fill and a `--rule-soft` ring while the rest of its list fades — no
   shadow, no scrim.
   Inputs exempt from both. Zoom needs all
   three of `userScalable: false`, `touch-action: pan-x pan-y` on `html, body`
   and `NoPinchZoom` — no one of them covers every browser, and desktop zoom is
   left alone.

## Gotchas
- **In dark, `--card` is darker than `--card-3`.** A raised thing takes
  `--seg-on`, which is lighter than its track in both themes.
- Something wrong on "the app" rather than one screen is a shell bug: look at
  `.app` / `.appbody` / `.scroll` in `globals.css` first, and check the fix on a
  screen that overflows.
- **One global stylesheet: a bare class name lands everywhere it is spelled.**
  `.linkbox` once named the import field too, and its `display: block` broke
  the copy box; `.billline.tip` takes every property of the tip jar's `.tip`.
  Grep a class before reusing it, and prefix a modifier with its block
  (`billextra`).
- **Native controls follow `color-scheme`, not the tokens.** Without it on the
  theme blocks the date field's calendar glyph stayed black on dark cards.
- iOS Safari in a tab ignores `user-scalable=no`; `preventDefault` on
  `gesturestart` is what holds the scale.
- **`color-mix` is used unguarded**, which puts the floor at Safari 16.2 and
  Chrome 111; below it `--hl-row`, `.mine`, `.btn-pair` draw flat and the
  dialog scrim opaque.
- **Two flex children that both claim the full width are not equal halves**:
  the overflow is shared by what is inside each. Equal halves are `.drow`'s
  `grid-auto-columns: minmax(0, 1fr)`.
- **A grid row holds as many items as it has children, and text counts once.**
  A sentence with a link in it becomes three items; wrap it in one `<span>`.
- **`money()` is locale-dependent**: `Intl` renders USD as "US$1.25" outside
  en-US. Dollars quoted in copy get `usd()` (`lib/format.ts`).
