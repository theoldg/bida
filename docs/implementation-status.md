# Implementation status

*For: an agent starting a cold session. The state of the project in one screen,
and the next thing to do. Everything here is a pointer — the doc that owns a
subject describes it, and this file says only where the project stands against
it. **It is not a log of what sessions built**: behaviour belongs in the doc
that describes it, and what a session learned the hard way belongs in that
doc's Gotchas. Update it in the same commit as the code it describes.*

## Where it stands

**Every phase is closed** (2026-09-05). The MVP shipped, then eight more phases
did; scanning was the last feature in. What is not built was cut rather than
queued — receipt photo storage, CSV export and categories are seams in
[product.md](product.md#deliberately-not-in-the-mvp), not work in progress.
[roadmap.md](roadmap.md) has the phase-by-phase record.

**Live** at <https://bida.bid> — one Worker serving the
static export *and* the sync API, backed by the `hajsik` D1 database
([hosting.md](hosting.md)). Verified against production, not just locally:
idempotent push, pull, a wrong token refused, and a real group synced between
two devices.

**There is a dev world beside it** since 2026-09-14:
<https://hajsik-dev.hajsik-api.workers.dev>, its own D1, its own scan secrets,
deployed by every push to `dev` — which is the branch sessions push to now.
Production moves only when the owner releases, by a button or by hand
([hosting.md](hosting.md#dev-and-production)).

**The scan endpoint composes its own request** since 2026-09-13: the phone
sends the photo and nothing else, so the shared Gemini key cannot be handed a
prompt of someone's choosing
([receipt-scanning.md](receipt-scanning.md#the-worker-owns-the-envelope)),
and **it has a budget** since 2026-09-14: three buckets, a global daily cap
that is the only number bounding the bill, and a Turnstile token in front of
every scan ([receipt-scanning.md](receipt-scanning.md#what-the-scan-costs)).
Armed in production on the same day — widget, both Worker secrets, migration
`0002` on the live D1 — and walked end to end by a person: challenge tapped,
receipt read.

**The app asks for money** since 2026-09-14, in one place: a FAB on the
balances tab opens `/g/tip`, which prices the only paid part of the app and
offers to split a donation like any other expense
([product.md](product.md#the-mvp)). The Buy Me a Coffee page is the owner's own.

**Sealed** since 2026-09-12 — the server cannot read a group
([ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)). The D1 log was
wiped once at that cutover so phones could refill it sealed, and that was **the
last reset it gets**: a schema change from here is a new numbered migration
([hosting.md](hosting.md#a-schema-change-from-here-on)).

## The next action

**Nothing is queued.** One thing is owed and is not code: a hard project quota
in Google AI Studio just above `SCAN_LIMITS.global`, which only the owner can
set ([../todo.md](../todo.md)). What else the owner wants is in
[../todo.md](../todo.md); two things are open rather than queued:

- **Why an installed phone still pauses.** The permanent hang is fixed
  ([frontend.md](frontend.md#a-live-read-can-die)), but the owner reports the
  skeleton rows still standing for 10–20s before they clear — suspiciously
  close to the watchdog's own 6s and 12s, so it may be the repair rather than
  the fault. `/diag` prints every span on one clock
  ([frontend.md](frontend.md#the-flight-recorder-and-diag)); **the next action
  is to read a timeline off the owner's phone**, not to guess again.
- **Two cuts to the entry form, proposed and not decided**: folding the
  "Multi-payer" link into the payer dialog, and taking "Items" out of the
  split's tab bar now that `/g/scan` is how a scan starts. Ask before building
  either.

## What a cold session needs to know

The app is a shared-expense ledger with no accounts: a group is a secret link,
every change is an appended op, and money is integer minor units. The five
non-negotiables in [CLAUDE.md](../CLAUDE.md#non-negotiables) are the ones worth
reading twice; past that, go to the doc for your task —
[docs/README.md](README.md) is the index.

Three things surprise people who assume otherwise, so they are worth naming
here before you read anything:

- **What a foreign amount is worth belongs to the group, not the entry.** One
  rate per currency, synced as an op; `atCurrentRates` values the whole ledger
  in one pass where state is read, so correcting a rate moves every entry
  already written in that currency ([ADR-0005](decisions/0005-money-and-currency.md)).
- **An entry is merged whole, a member or rate per field.** An expense op
  carries the entity as its saver saw it, so an amount can never sit beside
  another phone's split; `deletedAt` and `createdAt` are the exceptions that
  keep the healers working ([sync.md](sync.md#the-operation)).
- **History is read, never rewound.** The `restore` op kind still folds only
  because production groups hold some
  ([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)).
