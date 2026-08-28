# 0013 — The split editor is part of the expense form, and there are three modes

**Status:** Accepted · 2026-08-28
**Amends:** [0007](0007-per-screen-routes-not-drawers.md) — its routing table
listed `/g/split` as a screen. That route is gone; the rest of 0007 (one static
route per screen, group id in the query string, secret never in a URL) stands.

## Context

Adding an expense was four screens deep for a case that happens every time:
you typed an amount, tapped **Split**, landed on `/g/split`, tapped members,
tapped **Done**, came back. The owner, 2026-08-28:

> "make the splitting options more 'single screen', i don't want to move
> forward and backwards. Drop the percentage option, keep the even/as
> parts/as amounts"

Two problems, one shape. The split isn't a *different* question from the
expense — it is half of what an expense **is** — so pushing a route to answer
it made the form feel like a wizard. And a fourth split mode nobody uses
("percent") was taking a quarter of the mode control and forcing the other
three to be abbreviated to fit.

## Decision

**The split editor renders inline on `/g/expense/edit`.** It is
`components/split-editor.tsx`, it edits the same `ExpenseDraft`, and it shows
the mode control, the member list, each person's resolved share and the
allocation check without leaving the form. `/g/split` is deleted and
`route.split` with it.

**Three modes in the UI: Evenly, As parts, As amounts** — `equal`, `shares`,
`exact` in the data model, relabelled in the owner's words. The mode control
is now three wide buttons rather than four cramped ones.

**`percent` stays in `SplitSpec` and in `packages/core`.** It cannot be
*written* any more — no button produces it, and switching to any of the three
converts away from it — but ops already on a log carry it, and the folder,
`resolveSplit`, `validateSplit` and the expense detail screen all still read
it. Removing the variant would break the one thing the op log promises: that
old ops keep meaning what they meant.

`/g/payers` stays a screen of its own. It is genuinely a different question
(*who put money in*, not *who it was spent on*), it is rare — the form only
links to it when you ask for a second payer — and inlining a second member
list on the same form would put two similar lists a thumb apart. See
[data-model.md](../data-model.md#co-sponsored-expenses).

## Consequences

- Adding an expense is one screen and one **Save** for every ordinary case.
- The form is taller. It already scrolled; it now scrolls further with a
  five-person group. Judged the better trade: scrolling keeps the numbers you
  are checking against on the same surface as the total.
- The editor is a component, not a route, so a future "split this receipt
  line by line" surface can mount it somewhere else without a redirect.
- One route fewer in the static export, and one fewer screen in `pnpm shots`.
- A legacy percent expense opened in the editor shows its rows and its
  percentages read-only, with no mode selected. Touching any mode converts it
  and it will not come back.
