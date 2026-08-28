# 0012 — Balances and settling are one screen, and identity lives with the people

**Status:** Accepted · 2026-08-28

**Context.** The group view carried four bottom-bar destinations — Expenses,
Balances, Settle, Group — and the options screen carried a second copy of the
member list plus a timeline of this phone's identity changes. Each was
defensible alone; together they were more app than there is app. The owner asked
for the fat to come off, twice in one day.

Two of those were the same observation. **Balances** and **Settle** answered one
question in two places: the bars say a number is wrong and the suggested
payments are the only thing you can do about it, so flipping between them was
the user doing the app's joining-up by hand. **People** and *"who you are here"*
were the same list rendered twice, so a member could be renamed on one screen
and claimed on the other.

## Decision — one screen per question

- Bottom bar of three: **Expenses · Balances · Group**. `settleUp`'s transfers
  render under the balance bars on the same scroll; `?tab=settle` is gone.
  `/g/settle` — the form that *records* a payment — stays its own screen,
  because writing an op is not the same act as reading a suggestion.
- Claiming or switching identity happens on `/g/members`, on the row that
  already bears the member's name. This phone's identity timeline is deleted:
  identity changes have been ops since
  [0011](0011-identity-changes-are-public.md), so `/g/history` already renders
  them in order. `useIdentityLog` is deleted; the ops are untouched.
- `/g/options` keeps only what has no better home: one primary **Copy invite
  link** button and the two switches that belong to the phone. People and
  History become icons in `/g`'s top bar — one tap from the ledger instead of
  two through a menu.
- **A group cannot be renamed.** You name it when you create it. `renameGroup`
  stays in `commands.ts` because `group.update` ops still arrive over sync and
  must fold; nothing in the UI calls it.
- Explanatory paragraphs come out wherever the screen demonstrates the thing.

*(Superseded in part by [0014](0014-settings-belong-to-the-phone.md): the third
tab became `/settings` beside the group list.)*

## Consequences

- One less tab, one less timeline to keep truthful, and an options screen that
  fits on a phone with room to spare.
- A menu row is a worse home than a top-bar icon for a constant destination.
  Two icons is the ceiling; a third goes back to being a row.
- A bookmarked `?tab=settle` falls through to expenses, not an error.
- The balances screen is longer. That's the point: it is the whole of "where do
  we stand", so it may scroll.

## Rejected

- **Keep Settle as a fourth tab and trim its copy** — the two screens don't
  divide a subject, they divide a sentence.
- **Fold settling into the options screen** — it's the most-used thing in a
  group at the end of a trip; it doesn't belong behind a cog.
- **Keep the identity timeline as a filter on `/g/history`** — a control for a
  question the feed answers by being read.
- **Keep rename behind a confirmation** — a second way to do a once-per-lifetime
  thing was the whole problem in miniature. It can come back as a long-press on
  the title if anyone asks.
