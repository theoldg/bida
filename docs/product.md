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
not an account). Expenses (amount, currency, description, date, category, who
paid, who for). Split modes: evenly, as parts, as amounts — remainders
distributed deterministically and quietly. Balances, derived, never stored.
Settle-up plus recording a real reimbursement. Invite by link. CSV export.

**The three additions.**

1. **Version tracking.** Every change is an appended op with an author, a
   timestamp and an optional reason. Per-expense diffs, a group-wide feed, and
   restore-to-version — which appends a revision, never erases one.
2. **Multiple images per expense.** Downscaled on-device, queued until Wi-Fi,
   viewable full-screen.
3. **Personal mode.** Re-reads the app as *your* ledger: what each row did to
   your balance, signed and coloured; rows you're not in faded back; your net
   on top. On by default.

**Platform.** Installable PWA, fully usable offline for reads *and* writes.
Shared, not solo — sync is part of the MVP. Multi-currency, with the rate frozen
at entry ([ADR-0005](decisions/0005-locked-fx-rate.md)).

## Deliberately not in the MVP

Leave the seam. Build none of it.

| Deferred | The seam |
|---|---|
| Restaurant bill splitting | Line items become a new entity with its own op kinds |
| AI receipt OCR / NL entry | Attachments are addressable; OCR is a worker appending an `update` op |
| Recurring expenses | A generator that appends ops on a schedule; no schema change |
| Push notifications | Needs a member→device map, awkward under link-only access |
| Real-time collaboration | Swap polling for a Durable Object; the op log is already the wire format |
| Spend analytics | All derivable from the fold |

## Principles

- **The number you came for is at the top.** Net position first, detail below.
- **Never lose a write.** The op is in IndexedDB before the UI acknowledges it.
- **Show the arithmetic** — foreign amounts keep their figure and locked rate —
  but transparency isn't noise: a rounding cent is not worth a line of UI.
- **Colour is never the only signal.** Every debit/credit carries a sign and a
  word as well as a hue.

## Open questions

Decimal comma vs. point · whether restore is open to anyone · fixed vs.
free-form categories.

*Settled:* the name is **Hajsik** (2026-08-27); personal mode is default-on
(2026-08-28, [ADR-0014](decisions/0014-settings-belong-to-the-phone.md)).
