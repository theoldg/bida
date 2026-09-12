# 0035 — A quick split is a bill with no group

**Status:** Accepted · 2026-09-12

**Context.** Splitting a restaurant bill with people you will never share a
ledger with is the app's most common act among its least committed users, and
the price of it was a group: name it, name everyone, answer "which one of them
is you", and keep it on your list forever after. The owner asked for the bill
without the group — the right half of the home screen's `.btn-pair` has been
drawn and dead since. Everything the act needs is already built for the group
case: the scan, `readBill`, the who-had-what grid and `receiptBreakdown`
([0016](0016-receipts.md)). What a group adds on top of them is identity, an op
log, sync, balances and FX — every one of which is the cost of the *second*
expense, and a quick split never has one.

## Decision

**A quick split is an `EntryDraft` that never becomes an entry.** It appends no
op, so it needs no actor, so it never asks who you are — the question
[0003](0003-link-only-access.md) makes every `/g` route ask. It is held in the
same in-memory draft store as every other half-typed entry and discarded the
same way, with the same warning. Three routes take it — who and the bill, the
grid, the answer — and it ends by handing you text.

**It answers who owes what for this bill, and refuses every question after
it.** No payer, no balance, no settle-up, no correcting it tomorrow. Those are
what a group is, and a quick split that grew any of them would be a group with
a worse name for itself.

**The figures are bare — no symbol, no code, nowhere.** Nothing converts, so a
currency is not arithmetic here, it is a label, and a label the scan guessed at
is worse than none ([0005](0005-money-and-currency.md) governs the group case
and does not reach this one). A currency is still read off the bill for its
minor-unit exponent, since the split is integer minor units like all the rest.

**The scan endpoint authenticates a secret, not a membership**, and it refuses
an id D1 has never seen, because the alternative is an open proxy to our Gemini
key. So a quick split brings a credential shaped like a group's, and registers
it the way a group's first sync does: an empty `POST …/ops`, which is already
the call that writes an id and a secret hash on first sight (`ensureGroup`).
**No API change** — the endpoint that spends money stays read-only, which is
where a rate limit would go and not something to widen first. The row holds an
id, a hash and a timestamp; no op is ever pushed under it, so **the server
learns strictly less about a quick split than about a group**. The credential
is deliberately not in `groupKeys`, the table the sync engine walks.

**One credential per phone, not per bill**, minted on first need and kept in
the device store. A fresh id per split would write a row for every bill
anybody photographs and would make the caller unidentifiable across two scans
a minute apart — and a stable caller is exactly the unit anything we ever
throttle has to count, alongside the IP Cloudflare hands us. It is registered
before *every* scan rather than once and remembered: it costs one D1 read when
the row is already there, and it is the only version of this that survives the
row not being there — a phone that kept a credential the server has no record
of would otherwise be unable to scan, with nothing to say why.

**One grid, two doors.** The who-had-what screen becomes a component the group
route and the quick route both wear, as the scan control already is
([receipt-scanning.md](../receipt-scanning.md)). Two copies of that arithmetic
would disagree within a month.

## Consequences

- **Per-person figures need no split at all.** `receiptBreakdown`'s weights are
  already each person's own lines summed in minor units; a group divides a
  converted total by them, and a quick split, converting nothing, just reads
  them as the answer. They add to the bill's printed total by construction.
- **A reload loses it**, as it loses any draft. The cost is the names again and
  one more photo, and the alternative was a second kind of persistence for the
  one flow with nothing at stake.
- **No bill, no quick split.** It is scan-first by construction: an even split
  among people with no receipt is arithmetic, not a screen.
- **Nothing can be reopened, and turning one into a group means typing it
  again.** The seam is the draft: it is already the shape `addExpense` takes.
  What stops it is not the code but two questions — who paid, and who you are —
  that this flow exists to avoid.
- One empty row per phone accumulates in D1, holding nothing. A sweep of
  `last_op_seq = 0` rows is available if that ever matters.
- **A quick split's scans are linkable to each other server-side**, by that
  stable id, where per-split credentials would have been unlinkable. That is
  the price of being able to throttle a caller at all, and it buys the server
  nothing else: there is no content under the id to link them to.

## Rejected

- **A real group, hidden from the list.** It reuses more — the form, the
  ledger, "make it permanent" for free — and it brings back the actor, the ops,
  the sync and a second meaning for "this group is not really yours", which is
  the `archivedAt` filtering [0007](0007-a-screen-is-a-route.md) already
  regrets. The flow's whole value is the questions it does not ask.
- **An unauthenticated scan endpoint.** One line shorter, and it is our key
  behind it: anybody who reads the bundle gets a free vision model.
- **Registering the credential *in* the scan route** — `ensureGroup` instead of
  `getGroup`, one word, and it saves a round trip per scan. It also makes the
  one endpoint that spends money the one that writes rows, so a flood costs
  twice and the limiter has two things to reason about instead of one.
- **Keeping the split on the device so it survives a reload.** A quick split
  outlives a form, and losing one at the table is a real annoyance — but it is
  the only screen in the app that would remember what you half-typed, and
  "nothing half-typed is kept" is worth more than one retyped roster.
- **Handing the answer over as a link or an image.** A link has to carry the
  bill somewhere — a server (the privacy cost this feature otherwise avoids) or
  a fragment somebody can forward — and an image is a second drawing surface
  outside the monospace system, downloaded through the one mechanism an
  installed PWA is worst at. Text on the clipboard is what the invite link
  already taught us to do ([0008](0008-hand-rolled-interface.md)).
- **A currency picker.** One more control on a screen asked to be minimal, for
  a symbol nothing in the flow computes with.
