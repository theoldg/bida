# Design system

*For: anyone writing something a person will look at.*

**The mockups are the source of truth**, not this document —
[`design/mockups/index.html`](../design/mockups/index.html)'s token block is the
canonical palette in all three theme states. Port it into `globals.css`
verbatim, under the same names; never re-pick values by eye. This file explains
the reasoning so you extend the design rather than diverge from it.

## Direction

An accounting ledger: ruled paper, ink, a red column and a green column, and a
highlighter for the rows that are yours. Ledgers have solved the who-owes-what
presentation problem for centuries.

## Palette roles

| Token | Role |
|---|---|
| `--paper`, `--card`, `--card-2/3` | Grounds. Green-biased neutrals in light; plain neutrals in dark |
| `--ink`, `--ink-2`, `--muted` | Text, three levels |
| `--rule`, `--rule-soft` | Hairlines — the ruled-paper texture |
| `--brand` | Interactive things only: buttons, active tabs, links |
| `--credit` / `--debit` | **Semantic, reserved.** Money owed to you / by you |
| `--hl`, `--hl-edge`, `--hl-ink` | The highlighter: personal mode, and pending sync |

`--brand` and the semantic pair are separate on purpose. A "Save" button is not
a credit. Never colour a control with `--credit`.

**Dark is not the light palette turned down.** *(2026-08-27, owner: "the dark
theme is ugly make it less green/yellow".)* Two tints that read as warm paper at
90% lightness read as *stained* at 8%. Dark grounds are near-neutral
(`#121316`, `#17191D`, `#1E2126`), the brand mint is pulled towards teal
(`#78C9C2`) so it stops competing with `--credit`, and the highlighter is a
desaturated sand (`#C2A06B` edge, 16% wash). `--credit` and `--debit` keep their
hues — they're semantic and must not drift between themes. Both dark blocks
(`prefers-color-scheme` and `[data-theme="dark"]`) carry identical values, in
`globals.css` **and** the mockup. Change one, change all four.

## Personal mode is a highlighter

Tinting your rows in the brand colour fails: red and green already mean debit
and credit, and brand already means "tap this". A translucent amber wash reads
as something laid *over* the ledger, which is what a personal lens is. The same
amber marks pending sync — both mean "this is about you specifically, not the
shared record".

It never carries meaning alone. Each row shows what it did to your balance —
what you put in minus what you owe — as `+€45,00` in credit green or `−€14,28`
in debit red, with the left edge bar taking the same colour. Three signals for
one fact: sign, colour, bar. A row that nets to nothing keeps a neutral amber
edge. Rows you're not part of drop to 42% opacity rather than disappearing —
you should still see the group's spending.

## Type

| Role | Face |
|---|---|
| Display | Bricolage Grotesque — headings and the wordmark, 500–700 |
| Body | Karla — all prose and labels |
| Figures | IBM Plex Mono — **every number**, `font-variant-numeric: tabular-nums` |

Money is always monospaced and tabular so decimal points align down a column.
Prose and figures never mix in one line — a figure inside a sentence still gets
the mono span.

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
people are connected, which is what the double-headed swap arrow said.
*(2026-08-28.)* `i-arrow` replaced `i-swap` everywhere: transfer rows under the
balances, the `/g/settle` header, and the reimbursement badge in the ledger. It
always points payer → payee, left to right, matching the names beside it.

## Rules that are not negotiable

1. **Colour is never the only signal.** Debit and credit carry a sign *and* a
   word *and* a bar direction; pending sync carries a dot *and* a banner.
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
