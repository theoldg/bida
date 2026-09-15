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
link.

**The three additions.**

1. **Version tracking.** Every change is an appended op with an author, a
   timestamp and an optional reason. Per-entry diffs and a group-wide feed,
   read only ([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)).
2. **A receipt reads itself into the form.** Photograph a bill and it fills the
   expense, line items and all ([ADR-0016](decisions/0016-receipts.md)). The
   photo is read and thrown away — storing it was the other half of this and
   was cut.
3. **A personal lens, always on.** The app reads as *your* ledger: what each
   row did to your balance, signed and coloured; rows you're not in faded back;
   your net on top ([ADR-0007](decisions/0007-a-screen-is-a-route.md)).

**A bill with no group.** Quick split: name who is at the table, photograph
the receipt, assign the lines, and copy the answer out as text. It writes no
op and keeps nothing — the one thing here that is not a ledger
([ADR-0035](decisions/0035-a-quick-split-is-a-bill-with-no-group.md)).

**The tip jar.** One screen (`/g/tip`, off a FAB on the balances tab), and the
only ask in the app: no ads, no tier, nothing locked. It is a figure and two
buttons — `$5 ≈ 10,000 receipt scans`
([what a scan costs](receipt-scanning.md#what-the-scan-costs)), cut by the
group the way the group cuts everything else, then Buy Me a Coffee and an
ordinary expense to record what you gave. Donating happens on somebody else's
site; this writes no entry on its own, and the split opens the normal form
because it is a row in everyone else's ledger.

**Platform.** Installable PWA, fully usable offline for reads *and* writes.
Shared, not solo — sync is part of the MVP. Multi-currency, with one rate per
currency held by the group and corrected in one place
([ADR-0005](decisions/0005-money-and-currency.md)).

## Deliberately not in the MVP

Leave the seam. Build none of it.

| Deferred | The seam |
|---|---|
| Restaurant bill splitting as a real entity | Line items become a new entity with its own op kinds. A scan already reads them and the who-had-what grid already assigns them, into a `receipt` split that the expense stores and can reopen ([ADR-0016](decisions/0016-receipts.md)) — what is missing is editing a line as a thing in its own right |
| Recurring expenses | A generator that appends ops on a schedule; no schema change |
| Push notifications | Needs a member→device map, awkward under link-only access |
| Real-time collaboration | Swap polling for a Durable Object; the op log is already the wire format |
| Spend analytics | All derivable from the fold |
| Storing receipt photos | `attachment` is a real entity with its own op kind, folded and materialised, and `attachmentIds` is on the expense — nothing appends one. Add an R2 bucket and the upload behind `uploadState` ([ADR-0001](decisions/0001-cloudflare-workers-and-d1.md)) |
| CSV export | A pure function over the fold; no schema change, no new screen |
| Categories | `categoryId` is on the entry, diffed by the command layer and reported by history. What's missing is a picker, and a decision about what the categories are |

## Principles

- **The number you came for is at the top.** Net position first, detail below.
- **Never lose a write.** The op is in IndexedDB before the UI acknowledges it.
- **Show the arithmetic** — foreign amounts keep their figure and the rate used —
  but transparency isn't noise: a rounding cent is not worth a line of UI.
- **Colour is never the only signal.** Every debit/credit carries a sign and a
  word as well as a hue.
