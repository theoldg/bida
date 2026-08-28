# Product

*For: anyone deciding whether a change is in scope.*

## What it is

A shared-expense splitter for small groups — trips, flatshares, a run of dinners.
You add what you paid, say who it was for, and the app works out who owes whom.
Tricount is the reference point; this is that, plus three things Tricount does
badly or not at all.

## Who uses it

The owner and their friends. Realistically under 50 people ever, a few hundred
expenses a year. **Design for that.** Do not build for scale we will not have —
but also do not build something that corrupts data when two phones are offline
at once, because that will actually happen on a trip.

## The MVP

### Tricount parity

- **Groups** with a name, a base currency, and members.
  A member is a name, not an account — you can add "Ada" before Ada has ever
  opened the app.
- **Expenses**: amount, currency, description, date, category, who paid,
  who it was for.
- **Split modes**: evenly, as parts (weights), as amounts. Percentages were a
  fourth and were dropped from the UI — [ADR-0013](decisions/0013-the-split-editor-is-part-of-the-expense-form.md).
  Remainders are distributed deterministically, and quietly — the app never
  makes a feature of a single cent.
- **Balances** per member, derived, never stored.
- **Settle up**: a minimal set of payments that clears the group, plus the
  ability to record a real reimbursement as its own entry.
- **Invite** by sharing a link.
- **Export** to CSV.

### The three additions

1. **Version tracking.** Every change to anything is an appended operation with
   an author, a timestamp and an optional reason. Per-expense history with
   before/after diffs, a group-wide activity feed, and restore-to-version.
   Restoring appends a new revision; it never erases history.
2. **Multiple images per expense.** Several photos per expense — the bill, the
   card slip, the thing you bought. Downscaled on-device before upload, queued
   until Wi-Fi, viewable full-screen.
3. **Personal mode.** Re-reads the whole app as *your* ledger: what every row
   did to your balance, signed and coloured, expenses you're not part of faded
   back, and your own paid/owed/net at the top. On by default.

### Platform

- Installable PWA, **fully usable offline** — reads *and* writes.
  See [sync.md](sync.md).
- **Shared, not solo.** Sync through the worker is part of the MVP: the app is
  not finished until a second person opens the link on their own phone and sees
  the same ledger. See [roadmap.md](roadmap.md).
- Multi-currency: per-expense currency, converted to the group's base currency
  at a rate captured and frozen when the expense is entered
  ([ADR-0005](decisions/0005-locked-fx-rate.md)).

## Deliberately not in the MVP

Leave room for these. Build none of them yet.

| Deferred | Leave this seam |
|---|---|
| Restaurant bill splitting (line items, per-dish assignment) | An expense can already carry arbitrary JSON in its patch; line items become a new entity with its own op kinds |
| AI receipt OCR / natural-language entry | Attachments are already addressable; OCR is a worker that appends an `update` op |
| Recurring expenses | A generator that appends ops on a schedule; no schema change |
| Push notifications | Needs a member→device mapping, which link-only access makes awkward — solve later |
| Real-time collaboration | Swap polling for a Durable Object per group; the op log is already the wire format |
| Spend analytics / charts | All derivable from the fold; no storage change |

## Product principles

- **The number you came for is at the top.** Net position first, detail below.
- **Never lose a write.** Offline, mid-flight, tab closed — the op is in
  IndexedDB before the UI acknowledges it.
- **Show the arithmetic.** Foreign amounts keep their original figure and the
  rate they were locked at. Nobody should have to trust us. But don't confuse
  transparency with noise: a rounding cent is not worth a line of UI.
- **Colour is never the only signal.** Every debit/credit carries a sign and a
  word as well as a hue.

## Open product questions

Tracked in the mockup's closing section, unanswered as of the last session:
decimal comma vs. point; whether restore is open to anyone; fixed vs. free-form
categories; whether personal mode is default-on.

**Settled:** the app is called **Hajsik** (2026-08-27).
