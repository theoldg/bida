# 0032 — A name is enough: no initials square beside a person

**Status:** Accepted · 2026-08-30

**Context.** The owner: *"Drop the chip with the name initial next to users
names everywhere ... EXCEPT in the 'who was there' selector in receipt mode."*

Every screen that named a person drew a 34px square of their initials first: the
ledger, balances, settle-up, the payer picker, the split editor, the payers
editor, People, the claim screen, both sides of a transfer. Since
[ADR-0023](0023-monospace-monochrome.md) took the per-member tint away, that
square carried no information a reader didn't already have — it was the first
letter of the word printed next to it, in a lighter box. On a phone it cost the
left third of every row, which is the third where the thing a row is *about*
belongs.

## Decision

- **A person is their name.** No initials square anywhere a name is printed.
- **The who-had-what grid keeps them**, because there the initials are not a
  decoration but the column headings — a 20-line bill's columns have to stay
  named while the rows scroll, and there is no room for names across the top.
  The "who was there" strip above the grid keeps them for the same reason: it
  is what introduces those columns.
- **A group keeps one**, in the list of groups. That row has no other mark, and
  a group's name is nothing like a person's — the square reads as the group's
  face rather than as a repeated letter.
- **An income loses the inverted avatar** that marked it (ADR-0023, ADR-0028).
  The row already says "received" and prints its figure with a `+`, which is
  two signals for the one distinction and neither of them a square.
- **`ChoiceDialog` drops its `lead`.** Nothing passes one now, and a picker row
  is a label, a note and a check.

## Consequences

- Rows are text from their left edge. The ledger's coloured left edge, the sign
  and the personal-lens fade are what mark a row now, all of which are about
  *your* money rather than about whose initials they are.
- `Avatar` takes a name, not a `Member`: the only caller left is the groups list.
- `design/mockups/index.html` is updated to match — its person squares are gone
  and the balance row is two columns.

## Rejected

- **Keep them where a row has room** (People, the claim screen). A square that
  appears on some screens and not others reads as a status, not as a decoration.
- **Replace them with a coloured dot.** That is ADR-0023's per-member tint with
  fewer pixels, and the same objection applies: colour is spent on balances.
