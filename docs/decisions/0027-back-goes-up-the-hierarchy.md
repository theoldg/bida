# 0027 — Back climbs the hierarchy, so an up-link unwinds the history

**Status:** Accepted · 2026-08-30

**Context.** The owner: *"override back navigation to go up the hierarchy
instead of returning to the latest expense."*

Every back arrow already named a parent rather than "wherever you came from"
(`back={route.group(id)}`), but it was an ordinary `<Link>`, so going up
*pushed*. Open an expense, take the arrow back to the group, open another: the
group now sat on top of a stack holding both expenses, and the device's back
button — the Android button, the edge swipe, the one that isn't ours to
redesign — replayed that visit history. In a ledger you dip in and out of the
same rows a dozen times a sitting, so "back" meant the last expense you looked
at rather than the group it belongs to.

## Decision

- **An up-link unwinds; it doesn't navigate.** `lib/nav.ts`'s `goUp` looks for
  the parent among the entries *behind* the current one and goes straight back
  to it, however many entries that is. Only descending pushes, so what remains
  is the path from the groups list down to where you are, and the device back
  button climbs one level per press.
- **The parent is found, not counted.** The browser's Navigation API names its
  own entries; a saved count would be wrong the moment the browser trimmed the
  stack or the screen was opened from a link. Screens compare by path and
  query, ignoring query order and a trailing slash.
- **Where the API is missing (iOS before 18.4), an up-link replaces the current
  entry.** Never the wrong screen — at worst a back button that needs one extra
  press to leave.
- **Expenses / Balances `replace`.** They are two halves of one screen, so
  switching tabs is not somewhere you travelled through.
- **`router.back()` stays where "back" is the truth**: the payers, who-had-what
  and expense-form screens are only ever reached from the form below them, and
  their Done really does return to it.

## Consequences

- The screen you left stays reachable by the browser's *forward*, which is what
  forward is for.
- A screen opened cold from an invite link has no parent behind it; its arrow
  replaces, so the group list is one press away rather than the site you came
  from.
- Anything new that goes *up* or sideways must say so — a plain `<Link>` to an
  ancestor re-introduces exactly this bug.

## Rejected

- **Intercept `popstate` and route the back button ourselves.** Fighting the
  platform's own gesture for the same result, and it breaks the moment the user
  means to leave the app.
- **Make every up-link `replace`.** Simple, but it leaves the parent twice in a
  row on the stack: the first press of the device back button then appears to
  do nothing.
- **Track the trail ourselves in a module.** A second copy of something the
  browser already holds, and it desynchronises on every `replace` the app does
  after a save.
