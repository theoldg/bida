# Implementation status

*For: an agent starting a cold session. Where the project stands, and the next
thing to do. Everything here is a pointer — the doc that owns a subject
describes it, and this file says only where we stand against it. **It is not a
log of what sessions built.** Update it in the same commit as the code.*

## Where it stands

**The app is built, deployed and in use.** Nothing is queued: what is not built
was cut rather than postponed — receipt photo storage, CSV export and categories
are seams in [product.md](product.md#deliberately-not-in-the-mvp), not work in
progress.

| | |
|---|---|
| **Production** | <https://bida.bid> — one Worker serving the static export *and* the sync API, backed by the `hajsik` D1 ([hosting.md](hosting.md)) |
| **Dev** | <https://hajsik-dev.hajsik-api.workers.dev>, its own D1 and scan secrets, deployed by every push to `dev` — the branch sessions push to. Production moves only when the owner releases ([hosting.md](hosting.md#dev-and-production)) |
| **Sealed** | The server cannot read a group ([ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)). The D1 log is finished data: a schema change from here is a new numbered migration ([hosting.md](hosting.md#a-schema-change-from-here-on)) |
| **Scanning** | The Worker composes the request, so the shared Gemini key cannot be handed someone's prompt, and the scan has a budget — three buckets, a global daily cap, and Turnstile in front of every call ([receipt-scanning.md](receipt-scanning.md#what-the-scan-costs)). Staś mode, off and hidden on `/diag`, swaps the refusal wording for the vicious one ([receipt-scanning.md](receipt-scanning.md#staś-mode)) |
| **The tip jar** | A FAB on the balances tab opens `/g/tip`, which prices the only paid part of the app and offers to split a donation like any other expense ([product.md](product.md#the-mvp)) |

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
- **Who holds the lock when an installed phone hangs.** The owner's `/diag`
  showed every read queued behind a sync commit that could not start, clearing
  all at once a minute later — a lock held outside the page, most likely by
  another copy of the app frozen mid-transaction; it happens after the app sits
  inactive, perhaps more after an update. What a page can do is built
  ([frontend.md](frontend.md#a-live-read-can-die)). **Next: the owner's
  `chrome://indexeddb-internals` and `/diag` `copies:` line from the next
  hang**, which say which copy holds it and whether the fix belongs there.
- **Joining on iPhone ends in the wrong storage.** An invite opens a Safari
  tab that forgets after a week and shares nothing with the home-screen app, so
  a regular joins twice and claims twice. [ios.md](ios.md) is built — `/install`,
  the home banner, the join choice, and both halves of the invite the icon is
  added with. **Works on the owner's iPhone from `/install`** (2026-09-16),
  once `/install` stopped shipping a manifest Safari reads at load. **Next:**
  one install from a join's Add to home screen, whose `/diag` first load says
  whether iOS used the manifest (`/join#`) or the page URL (`/install#`); then,
  decided with the owner, Share from *any* page — every iOS tab page building
  its manifest at load from a localStorage copy of the invites, shaped by that
  answer.
- **Two cuts to the entry form, proposed and not decided**: folding the
  "Multi-payer" link into the payer dialog, and taking "Items" out of the
  split's tab bar now that `/g/scan` is how a scan starts. Ask before building
  either.

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
