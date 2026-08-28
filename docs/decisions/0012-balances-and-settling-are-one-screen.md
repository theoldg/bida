# 0012 — Balances and settling are one screen, and identity lives with the people

**Status:** Accepted · 2026-08-28

## Context

The group view carried four destinations in the bottom bar — Expenses,
Balances, Settle, Group — and `/g/options` carried a second copy of the member
list ("who you are here") with a timeline of this phone's identity changes
under it. Every one of those was defensible on its own. Together they were more
app than there is app.

The owner asked for the fat to come off: *"consolidate the 'settle' tab into
the 'balances' tab. drop the separate device identity history screen. move
changing identity to the people menu and remove it from settings. delete any
text that is unnecessary."* Then, looking at what was left: *"drop the people
options, they're already in the top right corner. drop the history and move it
next to the people icon in the top right corner. completely remove the option
to rename a group. invite link … should be a juicy button called 'copy invite
link'."*

Two of those are the same observation. **Balances** and **Settle** answered one
question in two places: the bars say a number is wrong, and the suggested
payments are the only thing you can do about it, so flipping between them was
the user doing the app's joining-up by hand. **People** and *"who you are
here"* were the same list of names rendered twice, which meant a member could
be renamed on one screen and claimed on the other.

## Decision

**One screen per question.**

- The bottom bar is three items: **Expenses · Balances · Group**. `settleUp`'s
  transfers render under the balance bars, on the same scroll. `?tab=settle` is
  gone; `route.group()` takes `"expenses" | "balances"`. `/g/settle` — the form
  that *records* a payment — stays a screen of its own, because writing an op is
  not the same act as reading a suggestion.
- Claiming or switching identity happens on `/g/members`, on the row that
  already bears the member's name; a check mark marks who this phone is. The
  copy on `/g/options` is gone.
- This phone's identity timeline is gone with it. Identity changes have been
  ops since [ADR-0011](0011-identity-changes-are-public.md), which means
  `/g/history` already renders them, in order, beside every other change. A
  second, device-filtered view of the same ops was a screen maintaining a
  parallel telling of a story the log already tells.
- `/g/options` keeps only what has no better home: **one primary button, "Copy
  invite link"**, and the two switches that belong to the phone (personal mode,
  theme). People and History are icons in `/g`'s top bar — one tap from the
  ledger instead of two through a menu — so the rows that duplicated them are
  gone.
- **A group cannot be renamed.** You name it when you create it. The
  `renameGroup` command stays in `lib/db/commands.ts` because `group.update`
  ops still arrive over sync and must still fold; nothing in the UI calls it.
- Explanatory paragraphs come out wherever the screen demonstrates the thing
  itself: a head count above a list that is the head count, a note promising
  the join screen will move on by itself, a restatement of the labels directly
  above it.

## Consequences

- One less tab, one less section, one less timeline to keep truthful, and an
  options screen that fits on a phone with room to spare.
- A menu row is a worse home than a top-bar icon for a destination people reach
  constantly. Two icons is the ceiling; a third destination goes back to being
  a row somewhere.
- `useIdentityLog` is deleted from `lib/hooks.ts`. Nothing else read it. The
  ops it derived from are untouched — this is a UI removal, not a data one.
- Anyone landing on a bookmarked `/g?id=…&tab=settle` gets the expenses tab
  (an unknown tab falls through to the default), not an error. The transfers
  they were after are one tap away on Balances.
- The balances screen is longer. That is the point: it is the whole of "where
  do we stand", so it is allowed to scroll.

## Rejected alternatives

- **Keep Settle as a fourth tab and just trim its copy.** The two screens do not
  divide a subject; they divide a sentence.
- **Fold settling into the group options screen.** It is the most-used thing in
  a group at the end of a trip. It does not belong behind a cog.
- **Keep the identity timeline, just move it to `/g/history` as a filter.** The
  history feed already lists identity ops. A filter would be a control on a
  screen for a question ("when did *this phone* change hands?") that the feed
  answers by being read.
- **Keep rename behind a confirmation instead of deleting it.** A group is
  named once, by the person creating it, on a screen with the field in front of
  them. Carrying a second way to do it — plus the prompt, the op, and the row —
  for something nobody does was the whole problem in miniature. It can come
  back as a long-press on the title if anyone ever asks.
