# 0007 — A screen is a route, back climbs the hierarchy, the chrome is thin

**Status:** Accepted · 2026-08-27 · revised through 2026-08-30

**Context.** The original plan put everything inside a group in drawers and
sheets over `/g`. Drawer state doesn't survive a reload or a back press unless
it's round-tripped through the URL anyway, and the component library it assumed
was never adopted ([0008](0008-hand-rolled-interface.md)). Later the group grew
four bottom-bar tabs and an options screen, and the owner asked for the fat to
come off more than once — most bluntly: *"remove the settings page entirely."*
And every back arrow named a parent but *pushed*, so the device's own back
button replayed which expenses you'd looked at rather than climbing out.

## Decision

- **Each screen is its own static route**, exported as its own HTML file, with
  the group id (never the secret) as a query parameter. A static export can't
  pre-render a page per group, but it can pre-render one per screen and read
  `?id=` at runtime. `apps/web/lib/group-link.ts`'s `route` object is the single
  place URLs are built; the table lives in [frontend.md](../frontend.md#routing).
- **One screen per question.** Balances and settling are one scroll: the bars
  say a number is wrong and the suggested transfers are the only thing you can
  do about it. A split is half of what an entry *is*, so the split editor is a
  component on the form, not a route. *Who put money in* is a genuinely
  different and rare question, so `/g/payers` stays a screen.
- **A group's bottom bar is two tabs — Ledger · Balances — and its top bar three
  icons**: History, People, invite link. There is no settings screen and no
  in-group options screen: the two device-wide preferences were a taste you set
  once (light/dark, now one icon button on the groups list) and a way of reading
  the ledger that the app simply does (the personal lens, unconditional).
- **An up-link unwinds; it doesn't navigate.** `lib/nav.ts`'s `goUp` finds the
  parent among the entries *behind* the current one and goes straight back to
  it. Only descending pushes, so what remains is the path from the groups list
  down to where you are, and the device back button climbs one level per press.
  The parent is found by comparing path and query, never by a saved count, which
  would be wrong the moment the browser trimmed the stack. Where the Navigation
  API is missing (iOS before 18.4) an up-link replaces the current entry — at
  worst one extra press to leave. The two tabs `replace`, since they are two
  halves of one screen. `router.back()` stays where "back" is the truth: the
  payers, who-had-what and entry-form screens are only reached from below.

## Consequences

- Every screen survives a refresh and has a real URL.
- The export still has a fixed, build-time set of pages — one per screen.
- The group id appears in a browser history entry. Fine: it confers nothing
  without the secret.
- Each `page.tsx` carries its own "read `?id=`, look up the group, render
  not-found" preamble instead of one drawer router.
- The balances screen is longer. That's the point: it is the whole of "where do
  we stand", so it may scroll.
- Anything new that goes *up* or sideways must say so — a plain `<Link>` to an
  ancestor re-introduces the replayed-history bug.
- Bookmarks to `/g/options`, `/settings`, `/g/settle`, `/g/split` and
  `/g/expense*` 404.
- **A group cannot be renamed.** You name it when you create it. `renameGroup`
  stays in `commands.ts` because `group.update` ops still arrive over sync and
  must fold; nothing in the UI calls it.

## Rejected

- **Keep drawers and round-trip their state through the query string** — that is
  per-screen routing with extra indirection, not less.
- **Keep Settle as a fourth tab and trim its copy** — the two screens didn't
  divide a subject, they divided a sentence.
- **Keep `/settings` for the theme alone** — a screen, a route and a nav item
  for one binary you set once.
- **Intercept `popstate` and route the back button ourselves** — fighting the
  platform's own gesture for the same result, and it breaks the moment the user
  means to leave the app.
- **Make every up-link `replace`** — it leaves the parent twice on the stack, so
  the first press of the device back button appears to do nothing.
