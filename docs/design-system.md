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
| `--paper`, `--card`, `--card-2/3` | Grounds. Green-biased neutrals, not grey |
| `--ink`, `--ink-2`, `--muted` | Text, three levels |
| `--rule`, `--rule-soft` | Hairlines. The ruled-paper texture |
| `--brand` | Interactive things only — buttons, active tabs, links |
| `--credit` / `--debit` | **Semantic, reserved.** Money owed to you / by you |
| `--hl`, `--hl-edge`, `--hl-ink` | The highlighter. Personal mode, and pending sync |

`--brand` and the semantic pair are separate on purpose. A "Save" button is not
a credit. Never colour a control with `--credit`.

## Personal mode is a highlighter

The obvious move — tint your rows in the brand colour — fails, because red and
green already mean debit and credit and the brand colour already means "tap
this". A translucent amber wash reads as something laid *over* the ledger, which
is precisely what a personal lens is.

It never carries meaning alone: a highlighted row also gets a solid left edge bar
and an explicit `you: €14,28` figure. Rows you're not part of drop to 42% opacity
rather than disappearing — you should still be able to see the group's spending.

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

## Rules that are not negotiable

1. **Colour is never the only signal.** Debit and credit always carry a sign
   *and* a word *and* a bar direction. Pending sync carries a dot *and* a banner.
2. **Both themes are designed.** Tokens are defined on bare `:root` (light),
   redefined under `@media (prefers-color-scheme: dark)` guarded with
   `:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]`.
   Never declare a colour only inside a media or `[data-theme]` block.
3. **Foreign currency keeps its original figure** under the converted one. The
   receipt says 620 MAD; the app must too.
4. **Rounding is confessed, not hidden.** If a cent can't divide, the UI says who
   absorbed it.
5. **`100dvh`, safe-area insets, thumb-reachable primary actions.** This is a
   phone app that people use standing up in a restaurant.

## Gotchas

*Add to this list every time one bites you.*

- No shadcn/ui dependency exists — components are hand-rolled from the mockup's
  own markup and token names (`--paper`, `--ink`, `--brand`, …), used verbatim,
  not remapped onto a component library's variable names. See
  [ADR-0008](decisions/0008-hand-rolled-css-not-shadcn.md).
