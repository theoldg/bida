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

**The app names itself once**, on the groups list: the mark beside *bida* —
lower-case always — the light/dark toggle opposite, and nothing under it; a
sub-line would caption the list you are already looking at. Every other top bar
says the thing you opened, so a second wordmark would be branding where a name
should be. The mark is `design/brand/logo.svg` itself, shown as an <img>: it is the one
place the app is allowed its own colours, because it carries its own ground
and is a tile rather than a glyph — the same square as the avatars under it.
Do not redraw it in `--brand` to make it theme-aware; that was tried, and a
tracing of a logo is a worse logo.

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
band pays `--kb` in its place. The entry form, the new-group form and the
who-had-what grid all end this way.

**Dark is not the light palette turned down.** *(2026-08-27, owner: "the dark
theme is ugly make it less green/yellow".)* Grounds are near-neutral in both
themes (`#0E0F11`, `#141517`, `#1A1C1F` dark), and `--credit`/`--debit` keep
their hues — they're semantic and must not drift. Both dark blocks
(`prefers-color-scheme` and `[data-theme="dark"]`) carry identical values.
Change one, change the other.

## Your own rows are highlighted

Always, not as a mode
([ADR-0007](decisions/0007-a-screen-is-a-route.md)). Your
rows take a translucent neutral wash, laid *over* the ledger; the same wash
marks pending sync, both meaning "this is about you, not the shared record".
Neutral rather than tinted, so the row's own green or red stays the only colour
on the line — and the *only* way you are marked, since a member is always
printed by name, never as "You".

The wash never carries meaning alone: each row shows what it did to your balance
— `+€45,00` green, `−€14,28` red, left-edge bar to match. A row netting to
nothing keeps a grey edge; rows you're not part of drop to 42% opacity rather
than disappearing.

## Nothing waits in silence

A screen that hasn't repainted yet and a screen that didn't hear you look
identical. Two states cover the gap, and neither is a spinner:

- **Press.** `--press` on `:active`, as a `linear-gradient` rather than a
  `background-color` so it composites over what the control already sits on.
  Instant down, `.2s` up; nothing moves and nothing scales. An inverted control
  — the primary button, the FAB — takes `--press-i` instead: ink washed over
  ink is a tint nobody can see, and a big Save that doesn't answer the thumb
  reads as a dead button. The browser's own
  tap highlight is off (late, and it disagrees), with `touch-action:
  manipulation` to drop the 300ms double-tap wait.
- **Waiting.** A list still coming out of Dexie draws `SkeletonRows`: same row
  height, same three columns, pulsing, staggered — arrival changes the text and
  not the layout. The frame around it is real and tappable.

## Type

**One face: JetBrains Mono**, 400–700, loaded once by `next/font` and
self-hosted. `--f-display` and `--f-body` are aliases of `--f-mono`, kept so the
CSS still speaks in roles. Hierarchy is weight and tracking only: headings 700
at `-.03em`, body 400/500 at 14px, labels and eyebrows uppercase at `.12em`.

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
amount is ever shown in minor units.**

## An arrow points one way, and an income says so twice

A settle row is a *thing to do* — "you pay Marie €12" — not a statement that two
people are connected, which is what the double-headed swap arrow said
*(2026-08-28)*. `i-arrow` always points payer → payee, left to right, matching
the names beside it; on the transfer form (`.transfer`) it sits between the two
sides and *pressing it reverses them*, because backwards is the mistake that
control exists to make cheap. Each side is labelled above the name, so "From" is
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
attempted, in `--debit`: `Failure` / `.failure`. **A held action always has
one**: Save greyed with nothing to read is a dead end, so the entry form keeps
a single reason line beside the payer field rather than one per branch.

A *refused* action points as well as saying why: a Save that can't go through
blooms the field that stopped it `--debit` and lets it settle back over ~600ms
— the amount's underline, the title's box, the placeholder in either — and so
does the multi-payer door, which has no amount to divide. A flash rather than a
held red, because the sentence is already holding the state and two things
saying it permanently is one too many; and it replays on every refusal, which
is what the two identical `-a`/`-b` animations in `globals.css` are for. Save
is spent for exactly as long as the flash — greyed instantly, eased back —
which is the press saying it landed, and stops the same press arriving again
over a form that is mid-way through saying no. It is
the one thing exempt from the global reduced-motion clamp: a colour settling is
what that guidance asks you to fall back *to*, and clamped it would be nothing
at all.

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
   opts into the app's own small `RowMenu` instead — the same event a real
   right-click sends (`components/long-press.tsx`, `components/row-menu.tsx`). A top bar
   whose actions outgrow it opens that same card from a button instead
   (`MenuButton`), so the app has one menu and not two.
   Inputs exempt from both. Zoom needs all
   three of `userScalable: false`, `touch-action: pan-x pan-y` on `html, body`
   and `NoPinchZoom` — no one of them covers every browser, and desktop zoom is
   left alone. *(Owner, 2026-08-27, 2026-08-30.)*

## Gotchas

- Something wrong on "the app" rather than one screen is a shell bug: look at
  `.app` / `.appbody` / `.scroll` in `globals.css` first, and check the fix on a
  screen that overflows.
- iOS Safari in a tab ignores `user-scalable=no` and lets `touch-action` stop
  only double-tap; `preventDefault` on `gesturestart` is what holds the scale.
- No shadcn/ui dependency exists, and no component library's variable names sit
  between the tokens and the app.
  [ADR-0008](decisions/0008-hand-rolled-interface.md).
