# 0007 — Per-screen static routes, not drawers/sheets within `/g`

**Status:** Accepted · 2026-08-27
**Amends:** [0004](0004-static-export-fragment-routing.md) — its routing table
and "everything inside a group is client state within `/g`" are superseded here.
0004's actual decision, the secret living only in the fragment, is untouched.

**Context.** 0004 called for expense detail, add expense, the split editor and
history to be client state inside `/g`, presented as shadcn `Drawer`/`Sheet`.
Building Phase 2 hit two problems: drawer state doesn't survive a reload or a
back press unless it's round-tripped through the URL anyway, and shadcn was
never actually adopted ([0008](0008-hand-rolled-css-not-shadcn.md)), so there
was no primitive to build on.

**Decision.** Each screen is its own static route, exported as its own HTML
file, with the group id (never the secret) as a query parameter — a static
export can't pre-render a page per group, but it can pre-render one per screen
and read `?id=` at runtime. The current route table lives in
[frontend.md](../frontend.md#routing), and
`apps/web/lib/group-link.ts`'s `route` object is the single place URLs are
built.

## Consequences

- Every screen survives a refresh and has a real URL — closer to how the app is
  used than "client state" was.
- The export still has a fixed, build-time-known set of pages — one per screen,
  not one per group — so `output: 'export'` works exactly as 0004 intended.
- The group id appears in a browser history entry. Fine: it confers nothing
  without the secret, which is 0004's actual security property.
- Each `page.tsx` needs its own "read `?id=`, look up the group, render
  not-found" boilerplate instead of one drawer router. In practice, a small
  `useSearchParams` read at the top of each screen.

## Rejected

- **Keep drawers and round-trip their state through the query string** — that is
  per-screen routing with extra indirection, not less.

**Revisit if** a single expense should be shareable as a deep link — 0004
already rejected that, for a reason unchanged here.
