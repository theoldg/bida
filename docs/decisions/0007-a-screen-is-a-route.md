# 0007 — A screen is a route, back climbs the hierarchy, the chrome is thin

**Status:** Accepted · 2026-08-27 · revised through 2026-08-30

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
  it, so only descending pushes and the device back button climbs one level per
  press. The parent is found by comparing path and query, never a saved count,
  which would be wrong the moment the browser trimmed the stack. Without the
  Navigation API (iOS before 18.4) an up-link replaces the current entry. The
  two tabs `replace`, being halves of one screen; `router.back()` stays where
  "back" is the truth — payers, who-had-what and the entry form are only reached
  from below.

## Consequences

- Every screen survives a refresh and has a real URL; the export still has a
  fixed build-time set of pages. The group id lands in a history entry, which
  confers nothing without the secret, and old bookmarks (`/g/options`,
  `/settings`, `/g/settle`, `/g/split`, `/g/expense*`) 404.
- Each `page.tsx` carries its own "read `?id=`, look up the group, render
  not-found" preamble instead of one drawer router.
- Anything new that goes *up* or sideways must say so — a plain `<Link>` to an
  ancestor re-introduces the replayed-history bug.
- **A group cannot be renamed.** You name it when you create it. `renameGroup`
  stays in `commands.ts` because `group.update` ops still arrive over sync and
  must fold; nothing in the UI calls it.

## Rejected

- **Keep drawers and round-trip their state through the query string** — that is
  per-screen routing with extra indirection, not less.
- **Keep Settle as a fourth tab, or `/settings` for the theme alone** — the
  first two screens divided a sentence rather than a subject; the second is a
  route and a nav item for one binary you set once.
- **Intercept `popstate` and route the back button ourselves** — fighting the
  platform's own gesture for the same result, and it breaks the moment the user
  means to leave the app.
- **Make every up-link `replace`** — it leaves the parent twice on the stack, so
  the first press of the device back button appears to do nothing.
