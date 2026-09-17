# Implementation status

*For: an agent starting a cold session. Where the project stands, and the next
thing to do. Everything here is a pointer — the doc that owns a subject
describes it, and this file says only where we stand against it. **It is not a
log of what sessions built.** Update it in the same commit as the code.*

## Where it stands

**The app is built, deployed and in use.** Nothing is queued: what is not built
was cut rather than postponed — receipt photo storage and categories are seams
in [product.md](product.md#deliberately-not-in-the-mvp), not work in progress.

|                 |                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Production**  | <https://bida.bid> — one Worker serving the static export *and* the sync API, backed by the `hajsik` D1 ([hosting.md](hosting.md))                                                                                                                                                                                                                                                                            |
| **Dev**         | <https://hajsik-dev.hajsik-api.workers.dev>, its own D1 and scan secrets, deployed by every push to `dev` — the branch sessions push to. Production moves only when the owner releases ([hosting.md](hosting.md#dev-and-production))                                                                                                                                                                          |
| **Sealed**      | The server cannot read a group ([ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)). The D1 log is finished data: a schema change from here is a new numbered migration ([hosting.md](hosting.md#a-schema-change-from-here-on))                                                                                                                                                                     |
| **Scanning**    | The Worker composes the request, so the shared Gemini key cannot be handed someone's prompt, and the scan has a budget — three buckets, a global daily cap, and Turnstile in front of every call ([receipt-scanning.md](receipt-scanning.md#what-the-scan-costs)). Staś mode, off and hidden on `/diag`, swaps the refusal wording for the vicious one ([receipt-scanning.md](receipt-scanning.md#staś-mode)). A phone that pastes its own Gemini key under **Advanced** skips all of that and calls Google directly ([receipt-scanning.md](receipt-scanning.md#a-key-of-your-own)) |
| **Versioned**   | `major.semi.minor` in the root `package.json`, in the corner of the `/about` top bar and the first line of `/diag`. Every push to `dev` deploys, so every push bumps the minor and `pnpm check` insists on it; the major is the owner's alone ([hosting.md](hosting.md#versions))                                                                                                                             |
| **The tip jar** | A FAB on the balances tab opens `/g/tip`, which prices the only paid part of the app and offers to split a donation like any other expense ([product.md](product.md#the-mvp))                                                                                                                                                                                                                                 |
| **Exportable**  | **Export data** in the group menu hands over one CSV in Splitwise's export shape, which is what Tricount imports too ([data-model.md](data-model.md#the-group-as-a-spreadsheet)) — share sheet, then download, then `/g/export` as text ([frontend.md](frontend.md#getting-a-group-off-the-phone)). Whether the share sheet takes a file inside an iOS home-screen app is the one part still waiting on a real phone ([ios.md](ios.md)) |

## What is open

None of these is started, and the first is not code at all.

- **A hard project quota in Google AI Studio**, just above `SCAN_LIMITS.global`
  — the belt under our own counter's braces. Only the owner can set it, in the
  console.
- **The hosted service has no liability line and no way to ask for a group to
  be deleted.** `/about` already says what the server sees and names the scan as
  the exception; this is the rest of it, and the repo being public makes it due.
- **`POST /ops` has no budget.** It registers any unseen group id and writes
  unbounded ops into a D1 that gets no further resets — the only door in the app
  with no ceiling on it ([sync.md](sync.md)). Giving credential-minting its own
  door is the shape of the fix.
- **Who holds the lock when an installed phone hangs.** A lock held outside the
  page by another copy of the app frozen mid-transaction, after the app sits
  inactive. Two cases are found and both are fixed. WebKit (2026-09-17): a
  pasted link loaded `/join` beside the list and each page's cache froze holding
  the database from the other, so paste now replaces the page. Brave
  (2026-09-17): `updateDevice` — the app's smallest write, and the only one
  taking `device` alone, which every list and group screen reads — ran from a
  hidden `/join`; it now waits for the front like the sync commit
  (`lib/db/visible.ts`), and `/diag` has a `stores:` line so the next lock is
  named rather than cross-read
  ([frontend.md](frontend.md#a-live-read-can-die)). The Brave report's loose end
  — reads restarting with no `live.retry` before them — was **Dexie re-running
  the querier itself**, and it named the third case: a write broadcasts to every
  copy on the origin, so the copy in front pokes a *backgrounded* one into
  opening a readonly transaction on every save. A tab beside an installed
  Android app hangs reliably on that, which is how it was reported
  (2026-09-17). A hidden page now reads nothing either, not just writes nothing.
  **Next: whether it happens again** — this is the first of the three fixes with
  a repro behind it rather than a single report.
- **Joining on iPhone ends in the wrong storage.** An invite opens a Safari
  tab that forgets after a week and shares nothing with the home-screen app, so
  a regular joins twice and claims twice. [ios.md](ios.md) is built — `/install`,
  the home banner, the claim screen's link to paste, and both halves of the invite the icon is
  added with. An in-app browser is a third storage and is refused outright
  ([ios.md](ios.md#the-in-app-browser--refused)); **unverified on the phone**,
  and the case to watch is a false positive, not a miss.
  **Works on the owner's iPhone from `/install`** (2026-09-16).
  Built since, unverified on the phone: Share from any page (every page's head
  builds the manifest at load from `bida.carry`), and the names coming along
  (the icon claims the member the tab was), and a launch of the icon reopening
  the group you were last in, which it alone never did — `start_url` is
  `/install`, so nothing about the address said it was a launch (2026-09-17).
  The owner's first run carried
  two groups but only the name picked after the page loaded; a stale head now
  reloads, though never before the shell is precached — on a first visit that
  reload came off the network and raced the precache (2026-09-17). A tap that landed on a route's RSC payload instead of a
  screen — reported on production, and the reason the Worker now redirects a
  payload navigated to as a page ([frontend.md](frontend.md#pwa)) — is fixed on
  `dev` and reaches phones when the owner releases. **Next: install from a group's
  page, not `/install`, and paste both `/diag`s** — it also settles whether iOS
  used the manifest, since no other page's URL carries anything.

## What a cold session needs to know

A shared-expense ledger with no accounts: a group is a secret link, every change
is an appended op, and money is integer minor units. The five non-negotiables in
[CLAUDE.md](../CLAUDE.md#non-negotiables) are worth reading twice; past that, go
to the doc for your task — [docs/README.md](README.md) is the index.

Three things surprise people who assume otherwise:

- **What a foreign amount is worth belongs to the group, not the entry.** One
  rate per currency, synced as an op; `atCurrentRates` values the whole ledger
  in one pass where state is read, so correcting a rate moves every entry
  already written in that currency
  ([ADR-0005](decisions/0005-money-and-currency.md)).
- **An entry is merged whole, a member or rate per field.** An expense op
  carries the entity as its saver saw it, so an amount can never sit beside
  another phone's split; `deletedAt` and `createdAt` are the exceptions that
  keep the healers working ([sync.md](sync.md#the-operation)).
- **History is read, never rewound.** The `restore` op kind still folds only
  because production groups hold some
  ([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)).
