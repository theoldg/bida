# 0007 — Per-screen static routes, not drawers/sheets within `/g`

**Status:** Accepted · 2026-08-27
**Amends:** [0004](0004-static-export-fragment-routing.md) — see that ADR's
routing table and "Everything inside a group... is client state within `/g`"
sentence, both superseded here. 0004's actual decision — the group secret lives
only in the URL fragment, never in a path or query string — is **not** touched
by this ADR and remains in force.

## Context

0004 called for expense detail, add expense, the split editor, and history to
all be client state inside a single `/g` route, presented as shadcn `Drawer` /
`Sheet` / `Dialog`. Building Phase 2 against that plan ran into two problems:

- A refresh, a back-button press, or a shared "look at this expense" moment
  inside a drawer loses its place — drawer state doesn't survive a reload
  unless it's independently round-tripped through the URL anyway, at which
  point it isn't really "just client state".
- shadcn was never actually adopted (see [0008](0008-hand-rolled-css-not-shadcn.md)),
  so there was no `Drawer`/`Sheet` primitive to build the plan on top of.

## Decision

Each screen is its own static route, exported as its own real HTML file.
The group id (never the secret) travels as a query string parameter, because
a static export can't pre-render a page per group id, but it can pre-render
one page per screen and read `?id=` at runtime:

```
/                                  groups list
/new                               create a group
/g?id=<groupId>&tab=…              the group view (expenses / balances / settle)
/g/expense?id=<groupId>&e=<id>     expense detail
/g/expense/edit?id=<groupId>[&e=<id>]  add or edit an expense
/g/split?id=<groupId>              split editor
/g/history?id=<groupId>[&e=<id>]   version history, whole-group or per-expense
/g/members?id=<groupId>            members
/g/settle?id=<groupId>&from=&to=&amount=  record a settlement
/join#<groupId>.<secret>           claims a member slot, then redirects into /g
/settings                          device settings
```

`apps/web/lib/group-link.ts`'s `route` object is the single place these are
built — nothing else in the app hand-assembles a URL. The secret still never
appears in any of them; it is read once from the fragment on `/join` (or
carried forward in memory/Dexie after that) and is not part of `route`'s
query strings.

## Consequences

- Every screen survives a refresh and has a real, bookmarkable-within-a-device
  URL — closer to how the app is actually used than "client state" was.
- The static export still has a fixed, build-time-known set of pages — one per
  screen, not one per group — so `output: 'export'` keeps working exactly as
  0004 intended.
- The group id is visible in the query string and would appear in a browser
  history entry or a device-local access log. This is fine: the id alone
  confers nothing without the secret, which is 0004's actual security property
  and is unchanged.
- One more thing to get right per screen: each `page.tsx` needs its own
  "read `?id=`, look up the group, render a not-found state" boilerplate,
  instead of one drawer router. In practice this is a small `useSearchParams`
  read at the top of each screen.

## Rejected

- **Keep drawers/sheets, round-trip their state through the query string
  anyway** — this is what the app would have organically turned into, at
  which point it's per-screen routing with extra indirection, not less.

## Revisit if

We want a single expense to be shareable as a deep link independent of the
group screen — 0004 already rejected that for a different reason (no
per-expense pages in a static export without knowing all expense ids at build
time), and that reasoning is unchanged here.
