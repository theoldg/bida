# 0007 — A screen is a route, back climbs the hierarchy, the chrome is thin

**Status:** Accepted · 2026-08-27 · revised through 2026-09-05

**Context.** The original plan put everything inside a group in drawers and
sheets over `/g`. Drawer state doesn't survive a reload or a back press unless
it's round-tripped through the URL anyway, and the component library it assumed
was never adopted ([0008](0008-hand-rolled-interface.md)). The group then grew
four bottom-bar tabs and an options screen, and the owner asked for the fat to
come off — most bluntly, *"remove the settings page entirely."* And every back
arrow named a parent but *pushed*, so the device's back button replayed which
expenses you'd looked at rather than climbing out.

## Decision

- **Each screen is its own static route**, exported as its own HTML file, with
  the group id (never the secret) as a query parameter. A static export can't
  pre-render a page per group, but it can pre-render one per screen and read
  `?id=` at runtime. `lib/group-link.ts`'s `route` object is the single place
  URLs are built; the table lives in [frontend.md](../frontend.md#routing).
- **One screen per question.** Balances and settling are one scroll: the bars
  say a number is wrong and the transfers are the only thing you can do about
  it. A split is half of what an entry *is*, so the split editor is a component
  on the form. *Who put money in* is a genuinely different and rare question, so
  `/g/payers` stays a screen.
- **Two bottom tabs — Ledger · Balances — and three top-bar icons**: History,
  People, invite link. There is no settings or options screen: the two
  device-wide preferences were a taste you set once (light/dark, one button on
  the groups list) and a way of reading the ledger the app simply does (the
  personal lens, unconditional).
- **An up-link unwinds; it doesn't navigate.** `lib/nav.ts`'s `goUp` finds the
  parent among the entries *behind* the current one and goes straight back to
  it, so only descending pushes. The parent is found by comparing path and
  query, never a saved count, which would be wrong the moment the browser
  trimmed the stack. Without the Navigation API (iOS before 18.4) an up-link
  replaces the current entry. The two tabs `replace`, being halves of one
  screen; `router.back()` stays where "back" is the truth — payers,
  who-had-what and the entry form are only reached from below.
- **An entry's parent is whoever linked to it.** Three screens link in from
  *beside* an entry rather than above it — the history feed, and the two "can't
  remove this yet" lists on People and Rates — and climbing to the group from
  there threw away the list you were working through. So those links name
  themselves (`via=history|members|rates`, `lib/group-link.ts`) and the entry
  unwinds to the list; from the ledger, with no `via`, the parent is the group
  as before. In the URL, not in memory, because a screen is a route: a reload
  must not move where back goes.
- **The device's back button agrees with the screen's arrow.** Unwinding alone
  left the two disagreeing wherever the arrow skipped a level, and on the entry
  form the arrow asked before throwing a typed draft away while the button just
  threw it away. So a *user*-initiated backward traversal is put to the screen
  before the browser answers it (`lib/back-button.ts`). The app's own traversals
  are left alone — taking those over would call the arrow in a loop — and so is
  a browser that won't be cancelled, which is the degradation, not a second
  behaviour.
- **Ask before cancelling; cancel only to climb.** The two kinds of arrow need
  opposite help. A screen that would lose typed work answers *may I leave?*
  first: no, and the press is cancelled with the dialog as the whole of the
  answer; yes, and the press is left alone, because the browser's back is where
  the arrow was going anyway. Nothing is re-navigated in its place. An arrow
  that climbs needs no help either — a screen opened from its parent has that
  parent one entry behind it — until it skips a level, and only then is the
  press cancelled and `goUp` run instead. Taking every press over was the same
  behaviour on paper and a worse one in the hand: a cancellation has to be
  re-navigated, and the re-navigation was counted against an index the browser
  had already moved. Asking first retired the busiest of those — every press on
  the four screens that hold typed work, typed or not. Naming the source in the
  link retired the history feed's: the press was already going there. What is
  left is one press in the app, the whole group's feed reached from one entry's
  own history, and it is the one the check drives.

## Consequences

- Every screen survives a refresh and has a real URL; the export still has a
  fixed build-time set of pages. The group id lands in a history entry, which
  confers nothing without the secret, and old bookmarks (`/g/options`,
  `/settings`, `/g/settle`, `/g/split`, `/g/expense*`) 404.
- **A shared link's first back press leaves the app, and cannot do otherwise.**
  Opening a link loads a new document, so pressing back out of it is a
  cross-document traversal — which the Navigation API reports `cancelable:
  false`, `canIntercept: false`. There is nothing to take over. Within a session
  every navigation is same-document and the arrow wins as described. This is
  that degradation, and it is the ordinary case of it rather than a rare one.
- Each `page.tsx` carries its own "read `?id=`, look up the group, render
  not-found" preamble instead of one drawer router.
- Anything new that goes *up* or sideways must say so — a plain `<Link>` to an
  ancestor re-introduces the replayed-history bug.
- **A group cannot be renamed, and nothing archives one.** You name it when you
  create it. Both writes are gone from the command layer — a command nothing calls
  does not help a `group.update` arriving over sync, which `fold.ts` applies
  without asking the command layer anything. The read side stays: the fold, and
  the words history says about an `archivedAt` it may still find in a
  production log.

## Rejected

- **Keep drawers and round-trip their state through the query string** — that is
  per-screen routing with extra indirection, not less.
- **Keep Settle as a fourth tab, or `/settings` for the theme alone** — the
  first two screens divided a sentence rather than a subject; the second is a
  route and a nav item for one binary you set once.
- **Leave the back button to the browser** (this ADR's original position: that
  cancelling it fights the platform's own gesture, and breaks the moment the
  user means to leave the app). Unwinding got the common paths to agree and no
  further, and the owner asked for the arrow's behaviour "always". The screen
  that can be left is the one with no back arrow, and it registers nothing —
  from the groups list the button still leaves the app.
- **Intercept `popstate`** — it fires once the browser has already moved, so
  the only way back is to push the screen again: a flicker, and a history
  entry per press. The Navigation API cancels beforehand.
- **Make every up-link `replace`** — it leaves the parent twice on the stack, so
  the first press of the device back button appears to do nothing.
- **One fixed parent per screen, the group for every entry** (this ADR's
  position until 2026-09-05, when the owner changed their mind): tidy on paper,
  and it dropped you out of the list you had opened the entry from.
