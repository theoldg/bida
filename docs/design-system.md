# Design system

*For: anyone writing something a person will look at.*

**The mockups are the source of truth**, not this document —
[`design/mockups/index.html`](../design/mockups/index.html)'s token block is the
canonical palette in all three theme states. Port it into `globals.css`
verbatim, under the same names; never re-pick values by eye. This file explains
the reasoning so you extend the design rather than diverge from it.

## Direction

A terminal: one monospace face, near-monochrome grounds, hairline rules, square
corners. Colour is a scarce resource spent only on money —
[ADR-0023](decisions/0023-monospace-monochrome.md). The ledger reading survives
underneath: ruled rows, a red column and a green column.

**The app names itself once**, on the groups list: the tally wordmark beside
*Hajsik*, the light/dark toggle opposite. Every other top bar says the thing you
opened, so a second wordmark would be branding where a name should be.

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

Two hues, and they mean one thing each. A "Save" button is not a credit, so
never colour a control with `--credit`; and because `--brand` is just ink, a
primary button is figure-ground inversion — an ink block with a paper glyph.
Adding a third hue is a regression. Avatars carry no tint: monospaced initials
and the printed name do the identifying. **The one sanctioned exception:**
destructive actions (`.btn-d`, "Leave group") take `--debit` as an outline, not
a fill — losing that warning to consistency would be a worse trade.

**Dark is not the light palette turned down.** *(2026-08-27, owner: "the dark
theme is ugly make it less green/yellow".)* Grounds are near-neutral in both
themes (`#0E0F11`, `#141517`, `#1A1C1F` dark), and `--credit`/`--debit` keep
their hues — they're semantic and must not drift. Both dark blocks
(`prefers-color-scheme` and `[data-theme="dark"]`) carry identical values, in
`globals.css` **and** the mockup. Change one, change all four.

## Your own rows are highlighted

Always, not as a mode
([ADR-0026](decisions/0026-the-groups-list-is-the-settings-screen.md)). Your
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
  Instant down, `.2s` up; nothing moves and nothing scales. The browser's own
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
figure doesn't add up. The big one on the expense form adds a thicker rule, a
small radius and a `--card-2` well while focused. Disabled fields drop the rule
to transparent rather than showing a dead one. Digits group with **U+202F**
while typing; saved figures group the way `Intl` does — deliberately different
([ADR-0015](decisions/0015-one-money-field-core-reports-numbers.md)). **No
amount is ever shown in minor units.**

## A settle-up arrow points one way

A settle row is a *thing to do* — "you pay Marie €12" — not a statement that two
people are connected, which is what the double-headed swap arrow said
*(2026-08-28)*. `i-arrow` always points payer → payee, left to right, matching
the names beside it.

## A dialog is ours, and its button says the act

Asking is never `prompt()` or `confirm()`: those arrive in another app's
typeface, announcing that the *site* is asking, with one line where a consequence
needs a paragraph. `components/dialog.tsx` is a real `<dialog>` — `showModal()`,
so focus and Escape are the platform's — filling the viewport and painting the
scrim itself. Inside: a hairline card, `Cancel` beside an act that names itself
("Leave group", never "OK"), `--debit` outlined when it destroys something. A
screen still wins where the decision needs the ledger on it, `/g/restore` and
`/g/settle` ([ADR-0025](decisions/0025-our-own-dialogs.md)).

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
6. **Nothing is selectable.** `user-select: none` on `body`, `.selectable` to opt
   back in; inputs exempt. A long press on a ledger row is a mis-tap.
   *(Owner, 2026-08-27.)*

## Gotchas

- No shadcn/ui dependency exists. Components are hand-rolled from the mockup's
  own markup and token names, used verbatim, not remapped onto a component
  library's variables. [ADR-0008](decisions/0008-hand-rolled-css-not-shadcn.md).
