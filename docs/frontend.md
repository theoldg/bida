# Frontend

*For: anyone writing UI, routing, or PWA code.*

## Stack

Next.js App Router with `output: 'export'`, TypeScript, Tailwind, shadcn/ui
(copied-in components, not a dependency), Dexie for IndexedDB.

**The whole app is client-side.** There is no server rendering, no server
action, no route handler in Next. The Worker's API is reached with `fetch`.
This is a deliberate consequence of being local-first: the client already has
the data, so rendering it on a server would mean fetching it twice.

## Routing

Only static routes exist, because a static export cannot generate pages for
group ids it doesn't know at build time.

| Route | Purpose |
|---|---|
| `/` | Groups list |
| `/g` | The group view — reads `#<groupId>.<secret>` from the fragment |
| `/join` | Landing for a shared invite link; claims a member slot |
| `/settings` | Device settings: which member is "you", personal mode default |

Everything inside a group — expense detail, add expense, split editor, history —
is **client state within `/g`**, presented as shadcn `Drawer` / `Sheet` /
`Dialog`. This matches how the mockups behave and how the app is actually used
one-handed. Deep links point at groups, never at individual expenses.

The group secret lives in the **URL fragment**, which browsers never send to a
server — see [ADR-0004](decisions/0004-static-export-fragment-routing.md).
Never move it into a path segment or query string "for convenience".

## State

- **Dexie is the store.** Use `dexie-react-hooks`' `useLiveQuery` to read; the UI
  re-renders when the materialised tables change. No Redux, no Zustand, no
  server-state library. Adding one is an ADR.
- Writes go through `lib/db/commands.ts` — one function per user intent
  (`addExpense`, `editExpense`, `restoreRevision`). Each builds an op, appends
  it, and materialises it in one Dexie transaction. **Components never write to
  Dexie directly.**
- Device-local, never-synced state (who "you" are, personal-mode toggle) lives in
  the `device` store.

## Personal mode

A boolean in device settings, exposed through one context. It changes rendering
only — never the underlying data, never what syncs. Concretely: your share on
each row, `opacity` on expenses you're not part of, your paid/share/net summary
above the list, and a filter. See [design-system.md](design-system.md) for the
visual treatment and why it's a highlighter and not a colour.

## PWA

- Manifest with maskable icons, `display: standalone`, theme colour matched to
  the ledger paper token per theme.
- Service worker precaches the app shell only. **The SW does not cache API
  responses** — Dexie is the offline data layer, and a second caching layer over
  the same data is how you get two disagreeing sources of truth.
- iOS: no beforeinstallprompt, so show an "Add to Home Screen" hint. Installing
  matters on iOS beyond convenience — see the IndexedDB eviction gotcha in
  [architecture.md](architecture.md#gotchas).

## Components worth building once

The mockups need exactly two things shadcn doesn't have: the **amount keypad**
and the **balance bar** (a bar around a centre axis, debit left, credit right).
Everything else maps to an existing primitive with our tokens swapped in.

## Gotchas

*Add to this list every time one bites you.*

- `output: 'export'` disallows route handlers, `next/image` optimisation, ISR,
  middleware, and dynamic params. If you need one of those, you are proposing a
  change to ADR-0004 — write it up rather than quietly adding the adapter.
- 100dvh, not 100vh, or iOS Safari's toolbar eats the bottom nav.
