# Frontend

*For: anyone writing UI, routing, or PWA code.*

## Stack

Next.js App Router with `output: 'export'`, TypeScript, Tailwind, Dexie for
IndexedDB. Components are hand-rolled, ported directly from the mockup's HTML
and CSS — no shadcn/ui, no Radix, see
[ADR-0008](decisions/0008-hand-rolled-css-not-shadcn.md).

**The whole app is client-side.** There is no server rendering, no server
action, no route handler in Next. The Worker's API is reached with `fetch`.
This is a deliberate consequence of being local-first: the client already has
the data, so rendering it on a server would mean fetching it twice.

## Routing

Only static routes exist, because a static export cannot generate pages for
group ids it doesn't know at build time. Each screen is its own route, with
the group id (never the secret) carried as a query string parameter — see
[ADR-0007](decisions/0007-per-screen-routes-not-drawers.md). `lib/group-link.ts`'s
`route` object is the one place these URLs get built; nothing else assembles
one by hand.

| Route | Purpose |
|---|---|
| `/` | Groups list |
| `/new` | Create a group |
| `/g?id=[&tab=]` | The group view — expenses / balances / settle, chosen by the bottom bar |
| `/g/expense?id=&e=` | Expense detail |
| `/g/expense/edit?id=[&e=]` | Add or edit an expense |
| `/g/split?id=` | Split editor |
| `/g/history?id=[&e=]` | Version history, whole-group or per-expense |
| `/g/members?id=` | Members |
| `/g/options?id=` | In-group options: identity (and its log), personal mode, theme, way out to People/History/invite |
| `/g/settle?id=&from=&to=&amount=` | Record a settlement |
| `/join#<groupId>.<secret>` | Landing for a shared invite link; claims a member slot |
| `/settings` | Device settings: theme, personal mode |

Deep links point at groups, never at individual expenses (unchanged from 0004).

The group secret lives in the **URL fragment**, which browsers never send to a
server — see [ADR-0004](decisions/0004-static-export-fragment-routing.md).
Never move it into a path segment or query string "for convenience". The group
*id* alone is fine in a query string — see 0007 — because it confers nothing
without the secret.

## State

- **Dexie is the store.** Use `dexie-react-hooks`' `useLiveQuery` to read; the UI
  re-renders when the materialised tables change. No Redux, no Zustand, no
  server-state library. Adding one is an ADR.
- Writes go through `lib/db/commands.ts` — one function per user intent
  (`addExpense`, `editExpense`, `restoreRevision`). Each builds an op, appends
  it, and materialises it in one Dexie transaction. **Components never write to
  Dexie directly.**
- Device-local, never-synced state (who "you" are, personal-mode toggle, theme)
  lives in the `device` store; the history of identity changes lives beside it in
  `identityLog` — see [ADR-0009](decisions/0009-identity-is-device-local.md).

### One navigation

`/g` used to render a top tab strip (Expenses · Balances · Settle up) *and* a
bottom bar (Expenses · Balances · History) whose middle item lit up for two of
the three tabs. Two navigations for one screen, disagreeing about where you were.

There is now exactly one: the bottom bar, four items —
**Expenses · Balances · Settle · Group**. `Tabs` has been deleted from
`components/chrome.tsx` along with its CSS; do not bring it back. A screen that
needs more destinations than fit in the bar puts them on `/g/options`, not in a
second row. *(Owner, 2026-08-27: "the tabs are incoherent … consolidate into a
bottom bar".)*

## Personal mode

A boolean in device settings, exposed through one context. It changes rendering
only — never the underlying data, never what syncs. Concretely: your share on
each row, `opacity` on expenses you're not part of, your paid/share/net summary
above the list, and a filter. See [design-system.md](design-system.md) for the
visual treatment and why it's a highlighter and not a colour.

## PWA

In scope for the MVP — this is a few small, build-time icon files, not
user-uploaded content, so it's unrelated to the receipt-hosting question (see
[standing-instructions.md](standing-instructions.md#skip-receipt-attachment-images-for-the-mvp-not-pwa-icons)).
`public/manifest.webmanifest` is in place and linked from `app/layout.tsx`.

- Manifest with maskable icons, `display: fullscreen` (falls back to
  `standalone` on browsers that don't support it — that's the spec's fixed
  fallback chain, not something we implement), theme colour matched to the
  ledger paper token per theme. iOS ignores manifest `display` for home-screen
  web apps entirely; `appleWebApp.statusBarStyle: "black-translucent"` in
  `app/layout.tsx` is the equivalent lever there — it draws the app under the
  status bar rather than fullscreen replacing it, which is why `viewport-fit:
  cover` and the `env(safe-area-inset-top)` padding on `.topbar` matter.
- `public/sw.js` precaches the app shell (every static route, per ADR-0007's
  known-at-build-time set, plus the manifest and icons) and is registered from
  `components/register-sw.tsx` in the root layout. **The SW does not cache API
  responses** — it explicitly skips `/api/*` — Dexie is the offline data layer,
  and a second caching layer over the same data is how you get two disagreeing
  sources of truth. Pages are served network-first with a cache fallback;
  hashed `/_next/static/` assets are cache-first since they're immutable.
  `CACHE_VERSION` inside the file must be bumped by hand whenever its caching
  behaviour changes, so old installs drop their stale cache on next activate.
- iOS: no beforeinstallprompt, so show an "Add to Home Screen" hint. Installing
  matters on iOS beyond convenience — see the IndexedDB eviction gotcha in
  [architecture.md](architecture.md#gotchas).

## Components worth building once

The two components with real logic behind them, not just markup, are the
**amount input** and the **balance bar** (a bar around a centre axis, debit
left, credit right) — see `components/bits.tsx`.

The amount input is a real `<input inputMode="decimal">` styled as the big
figure, not the mockup's hand-built keypad. The keypad was replaced on
2026-08-27 at the owner's request — "there should be a cursor in the price
input, and also maybe just let the native digit keyboard pop up". A rendered
`<span>` has no caret, cannot be tapped into the middle of, and made every
phone's own numeric keyboard unreachable. The input sanitises as you type
(digits, one separator, fraction clipped to the currency's exponent), accepts
"," and "." alike, and autofocuses on a *new* expense only — never when
editing, where stealing focus would scroll the form away from what you came to
change. Everything else is markup and
CSS lifted directly from the mockup (see
[ADR-0008](decisions/0008-hand-rolled-css-not-shadcn.md)).

## Gotchas

*Add to this list every time one bites you.*

- `output: 'export'` disallows route handlers, `next/image` optimisation, ISR,
  middleware, and dynamic params. If you need one of those, you are proposing a
  change to ADR-0004 — write it up rather than quietly adding the adapter.
- 100dvh, not 100vh, or iOS Safari's toolbar eats the bottom nav.
