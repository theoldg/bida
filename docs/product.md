# Product

*For: anyone deciding whether a change is in scope.*

A shared-expense splitter for small groups — trips, flatshares, a run of
dinners. Tricount is the reference point, plus three things it does badly or
not at all.

**Who uses it:** the owner and their friends. Under 50 people ever, a few
hundred expenses a year. Design for that — but don't corrupt data when two
phones are offline at once, because that will happen on a trip.

## The MVP

**Tricount parity.** Groups (name, base currency, members — a member is a name,
not an account). Three kinds of entry — **expenses**, **incomes** and
**transfers** (amount, currency, description, date, category, who paid, who
for) ([ADR-0010](decisions/0010-what-an-entry-is.md)). Split modes: evenly,
as parts, as amounts — remainders distributed deterministically and quietly.
Balances, derived, never stored. Settle-up, which records a transfer. Invite by
link. CSV export.

**The three additions.**

1. **Version tracking.** Every change is an appended op with an author, a
   timestamp and an optional reason. Per-entry diffs and a group-wide feed,
   read only ([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)).
2. **Multiple images per expense.** Downscaled on-device, queued until Wi-Fi,
   viewable full-screen.
3. **A personal lens, always on.** The app reads as *your* ledger: what each
   row did to your balance, signed and coloured; rows you're not in faded back;
   your net on top ([ADR-0007](decisions/0007-a-screen-is-a-route.md)).

**Platform.** Installable PWA, fully usable offline for reads *and* writes.
Shared, not solo — sync is part of the MVP. Multi-currency, with one rate per
currency held by the group and corrected in one place
([ADR-0005](decisions/0005-money-and-currency.md)).

## Deliberately not in the MVP

Leave the seam. Build none of it.

| Deferred | The seam |
|---|---|
| Restaurant bill splitting as a real entity | Line items become a new entity with its own op kinds — the scan already reads them, and a receipt scan can assign them ad hoc into a `shares` split today ([ADR-0016](decisions/0016-receipts.md)), but they aren't stored or re-editable after saving |
| Recurring expenses | A generator that appends ops on a schedule; no schema change |
| Push notifications | Needs a member→device map, awkward under link-only access |
| Real-time collaboration | Swap polling for a Durable Object; the op log is already the wire format |
| Spend analytics | All derivable from the fold |

## Principles

- **The number you came for is at the top.** Net position first, detail below.
- **Never lose a write.** The op is in IndexedDB before the UI acknowledges it.
- **Show the arithmetic** — foreign amounts keep their figure and the rate used —
  but transparency isn't noise: a rounding cent is not worth a line of UI.
- **Colour is never the only signal.** Every debit/credit carries a sign and a
  word as well as a hue.

## Open questions

Decimal comma vs. point · fixed vs. free-form categories.

*Settled:* the name is **Hajsik** (2026-08-27); the personal lens isn't a
setting at all (2026-08-30,
[ADR-0007](decisions/0007-a-screen-is-a-route.md)).
