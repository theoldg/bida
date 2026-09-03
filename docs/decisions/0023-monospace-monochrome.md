# 0023 — One monospace face, colour only on money, a name is enough

**Status:** Accepted · 2026-08-29 · names 2026-08-30

**Context.** The original direction was a paper accounting ledger: warm
green-biased grounds, three typefaces, an amber highlighter, six per-member
avatar tints, a teal brand. By the balances screen a row could carry a brand
teal, an amber wash, an avatar tint and a credit green at once — four colour
systems arguing about which one you should read. The owner asked for the
opposite: a minimal monospace look, *"basically only subtle green and red for
the balances."* Later, once the tints were gone: *"Drop the chip with the name
initial next to users names everywhere … EXCEPT in the 'who was there' selector
in receipt mode."*

## Decision

The tokens and their roles are
[design-system.md](../design-system.md#palette-roles); this is what binds.

- **One typeface — JetBrains Mono** — for headings, prose and figures alike.
  Hierarchy is weight and tracking, never family. Grounds are plain near-neutral
  greys in both themes.
- **Exactly two hues exist**: `--credit` and `--debit`, spent only on money.
  Everything else — the primary button, the active tab, the focus ring, the
  personal-lens highlighter — is ink, a ground, or a rule. **A third hue is a
  regression, not an addition.**
- **A person is their printed name.** No tint, and no initials square beside a
  name anywhere: since the tints went, that square was the first letter of the
  word next to it, in a lighter box, costing the left third of every row.
- **The who-had-what grid keeps its initials**, because there they are the
  column headings — a 20-line bill's columns must stay named while the rows
  scroll, and there is no room for names across the top.
- **A group keeps one square**, in the list of groups. That row has no other
  mark, and a group's name is nothing like a person's: it reads as the group's
  face rather than as a repeated letter.

## Consequences

- Rows are text from their left edge. What marks a row is its coloured left
  edge, the sign on its figure and the personal-lens wash — all about *your*
  money rather than whose initials they are. `Avatar` takes a name, not a
  member; the only caller is the groups list.
- Body text is monospace at 14px, so it sets wider: titles truncate a word
  earlier and long labels have less room. The cost of the look, paid
  deliberately.
- **The one sanctioned exception to two hues:** destructive actions take
  `--debit` as an outline, not a fill. Losing that warning to consistency would
  be a worse trade.

## Rejected

- **Keeping the initials where a row has room** (People, the claim screen) — a
  square that appears on some screens and not others reads as a status.
- **Replacing them with a coloured dot** — that is the per-member tint with
  fewer pixels, and colour is spent on money.
