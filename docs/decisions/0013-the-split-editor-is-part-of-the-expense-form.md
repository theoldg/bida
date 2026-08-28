# 0013 — The split editor is part of the expense form, and there are three modes

**Status:** Accepted · 2026-08-28
**Amends:** [0007](0007-per-screen-routes-not-drawers.md) — `/g/split` is gone
from its route table. The rest of 0007 stands.

**Context.** Adding an expense was four screens deep for the commonest case
there is: type an amount, tap **Split**, land on `/g/split`, tap members, tap
**Done**, come back. The owner: *"make the splitting options more 'single
screen', i don't want to move forward and backwards. Drop the percentage option,
keep the even/as parts/as amounts."* The split isn't a *different* question from
the expense — it is half of what an expense **is** — so pushing a route to
answer it made the form a wizard. And a fourth mode nobody used was taking a
quarter of the mode control.

## Decision

- **The split editor renders inline on `/g/expense/edit`** as
  `components/split-editor.tsx`, editing the same `ExpenseDraft` and showing the
  mode control, member list, resolved shares and the allocation check without
  leaving the form. `/g/split` and `route.split` are deleted.
- **Three modes in the UI: Evenly · As parts · As amounts** (`equal`, `shares`,
  `exact`), in the owner's labels, as three wide buttons.
- **`percent` stays in `SplitSpec` and in `packages/core`**, readable but
  unwritable: no button produces it, and switching modes converts away from it.
  Removing the variant would break the one thing the op log promises — that old
  ops keep meaning what they meant.
- **`/g/payers` stays a screen.** *Who put money in* is genuinely a different
  question and a rare one, and inlining a second member list would put two
  similar lists a thumb apart.

## Consequences

- Adding an expense is one screen and one **Save** for every ordinary case.
- The form is taller and scrolls further with a five-person group. The better
  trade: the numbers you're checking stay on the same surface as the total.
- The editor is a component, not a route, so a future "split this receipt line
  by line" surface can mount it without a redirect.
- One route fewer in the export, one scene fewer in `pnpm shots`.
- A legacy percent expense opens with its rows and percentages read-only and no
  mode selected. Touching any mode converts it, and it won't come back.
