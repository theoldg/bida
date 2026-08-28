# Design system

*For: anyone writing something a person will look at.*

**The mockups are the source of truth**, not this document. This explains the
reasoning so you extend the design rather than diverge from it.

- Published: https://claude.ai/code/artifact/5195880f-3985-4409-ac1a-854e5a756921
- Source: [`design/mockups/index.html`](../design/mockups/index.html) — the token
  block at the top of that file is the canonical palette. Port it into
  `globals.css` verbatim, under the same variable names; do not re-pick values
  by eye. No shadcn — see [ADR-0008](decisions/0008-hand-rolled-css-not-shadcn.md).

## Direction

An accounting ledger. Ruled paper, ink, a red column and a green column, and a
highlighter for the rows that are yours. The vernacular does real work here: this
is an app about who owes what, and ledgers have solved that presentation problem
for several centuries.

## Palette roles

| Token | Role |
|---|---|
| `--paper`, `--card`, `--card-2/3` | Grounds. Green-biased neutrals in light; **plain neutrals in dark** (see below) |
| `--ink`, `--ink-2`, `--muted` | Text, three levels |
| `--rule`, `--rule-soft` | Hairlines. The ruled-paper texture |
| `--brand` | Interactive things only — buttons, active tabs, links |
| `--credit` / `--debit` | **Semantic, reserved.** Money owed to you / by you |
| `--hl`, `--hl-edge`, `--hl-ink` | The highlighter. Personal mode, and pending sync |

`--brand` and the semantic pair are separate on purpose. A "Save" button is not
a credit. Never colour a control with `--credit`.

### Dark is not the light palette turned down

*Retuned 2026-08-27 — owner: "the dark theme is ugly make it less green/yellow".*

The first dark palette was the ledger-paper palette darkened, which kept paper's
green bias: `--paper:#11150E` and `--card:#191E15` are olive-blacks, and against
them the amber highlighter went full yellow. Two tints that read as *warm paper*
at 90% lightness read as *stained* at 8%.

So the dark grounds are now near-neutral (`#121316`, `#17191D`, `#1E2126`) with
no measurable hue cast, the brand mint is pulled towards teal (`#78C9C2`) so it
stops competing with `--credit` green, and the highlighter is a desaturated sand
(`#C2A06B` edge, 16% wash) — the same family as light's amber, dialled back
until it stops shouting. `--credit` and `--debit` keep their hues: they are
semantic and must not drift between themes.

Both dark blocks — the `prefers-color-scheme` one and the `[data-theme="dark"]`
one — carry identical values, in `apps/web/app/globals.css` **and**
`design/mockups/index.html`. Change one, change all four.

## A settle-up arrow points one way

Money moving between two people has a direction, and the row is a *thing to do*
— "you pay Marie €12" — not a statement that the two of you are connected. The
double-headed swap arrow the mockup used said the second thing, and read as
"these two are square". *(Owner, 2026-08-28: "make the settle screen arrows one
sided, it's quite confusing with the bidirectional arrows".)*

`i-arrow` replaces `i-swap` in the sprite and everywhere it was used: the
transfer rows under the balances, the `/g/settle` header, and the badge on a
recorded reimbursement in the ledger. It always points **from the payer to the
person being paid**, left to right, matching the order of the names beside it.

## Personal mode is a highlighter

The obvious move — tint your rows in the brand colour — fails, because red and
green already mean debit and credit and the brand colour already means "tap
this". A translucent amber wash reads as something laid *over* the ledger, which
is precisely what a personal lens is.

It never carries meaning alone: a highlighted row also gets a solid left edge bar
and an explicit figure. Rows you're not part of drop to 42% opacity rather than
disappearing — you should still be able to see the group's spending.

**The figure is signed, and the edge bar takes its colour** *(2026-08-28, owner:
"make it more obvious which expenses affect me positively vs negatively")*. Each
row shows what it did to your balance — what you put in for it minus what you
owe for it — as `+€45,00` in credit green or `−€14,28` in debit red, with the
left edge bar green or red to match. Three signals for one fact: the sign, the
colour, and the bar. The amber wash still marks the row as *yours*; the sign
says which way it went. A row that nets to nothing keeps the neutral amber edge.

The same amber marks **pending sync**, and that overlap is intentional: both mean
"this is about you specifically, not the shared record".

## Type

| Role | Face | Notes |
|---|---|---|
| Display | Bricolage Grotesque | Headings and the wordmark. 500–700 |
| Body | Karla | All prose and labels |
| Figures | IBM Plex Mono | **Every number**, with `font-variant-numeric: tabular-nums` |

Money is always monospaced and tabular so decimal points align down a column and
a total can be eyeballed without being read. Prose and figures never mix within
one line — a figure inside a sentence still gets the mono span.

## A money field has an underline

Every field you type an amount into — the big expense figure, an FX rate, a
split row in *as amounts*, a payer's contribution, a settlement — is the same
component wearing `.amountfield`: an inline-flex wrapper with a bottom rule that
is `--rule` at rest, `--brand` on `:focus-within`, and `--debit` (rule *and*
text) when the figure doesn't add up. The big one on the expense form adds a
thicker rule, a small radius and a `--card-2` well while focused, so the
headline figure reads as the thing you are editing. Disabled fields drop the
rule to transparent rather than showing a dead one.

Digits group with **U+202F**, a narrow no-break space, while you type. Saved
figures group the way `Intl` does for the locale. That difference is deliberate
— see [ADR-0015](decisions/0015-one-money-field-core-reports-numbers.md).

No amount is ever shown to a person in minor units. Core hands the UI a number
and a problem code; the screen formats it.

## Rules that are not negotiable

1. **Colour is never the only signal.** Debit and credit always carry a sign
   *and* a word *and* a bar direction. Pending sync carries a dot *and* a banner.
2. **Both themes are designed.** Tokens are defined on bare `:root` (light),
   redefined under `@media (prefers-color-scheme: dark)` guarded with
   `:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]`.
   Never declare a colour only inside a media or `[data-theme]` block.
3. **Foreign currency keeps its original figure** under the converted one. The
   receipt says 620 MAD; the app must too.
4. **Rounding is silent.** A leftover minor unit rotates between people, seeded
   by the expense id — deterministic, but never rendered. The owner asked for it
   as a quiet easter egg, not a row of UI; see
   [standing-instructions](standing-instructions.md#dont-make-a-feature-of-the-odd-cent).
5. **`100dvh`, safe-area insets, thumb-reachable primary actions.** This is a
   phone app that people use standing up in a restaurant.
6. **Nothing is selectable.** `user-select: none` on `body`, opt back in with
   `.selectable`. Inputs and textareas are exempt so typing behaves normally. A
   long press on a ledger row is a mis-tap, not a request to copy — the
   selection handles that used to appear were pure noise. *(Owner, 2026-08-27:
   "none of the text anywhere should be selectable".)*

## Gotchas

*Add to this list every time one bites you.*

- No shadcn/ui dependency exists — components are hand-rolled from the mockup's
  own markup and token names (`--paper`, `--ink`, `--brand`, …), used verbatim,
  not remapped onto a component library's variable names. See
  [ADR-0008](decisions/0008-hand-rolled-css-not-shadcn.md).
