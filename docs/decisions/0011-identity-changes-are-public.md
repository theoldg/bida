# 0011 — A device's identity claim is an op, so `actor` can be read

**Status:** Accepted · 2026-08-28

**Supersedes [0009](0009-identity-is-device-local.md).**

## Context

Every op carries `actor` — the member id that made the change — and the whole
history UI is built on it: *"Marie changed the amount"*, *"Sam's edit was later
overwritten by Marie's"*. The owner put the point plainly: **"the edits should
record who did it, and that's why i wanted to track the identity changes, also
on the public log."**

[ADR-0009](0009-identity-is-device-local.md) had kept the identity claim, and
the log of changes to it, device-local: a `identityLog` table that never left
the phone. That decision looked at identity on its own and asked "is this a fact
about the group?". Asked beside `actor`, the answer changes.

`actor` is only meaningful if you can tell when the device speaking for a member
started, or stopped, speaking for them. A phone that was Sam and is now Marie
produces ops attributed first to one and then to the other, and with the claim
hidden there is nothing in the log that explains the seam. The attribution is
recorded but not *auditable* — which is the part that matters when someone asks
"I didn't change that, who did?".

## Decision

**Claiming or switching identity is an op like everything else.**

`EntityKind` gains `identity`. The entity id is **the device's HLC node id**,
and the patch is `{ memberId, claimedAt }`. It folds into `GroupState.identities`
— one row per device — and shows up on `/g/history` beside every other change:
*"Theo started editing from a new device"*, *"Sam handed a device over to
Marie"*. The actor of a switch is the member the device spoke for a moment ago,
because that is who made it.

`meByGroup` on the device record stays exactly where it was: it is the pointer
this phone reads to answer "am I Sam?", and it is what personal mode and the
"You paid" pronouns use. What changed is that *changing* it also appends an op.
The device-local `identityLog` table is gone (Dexie v3 drops it) — the op log
now carries the same timeline, and two logs of the same thing is how one of them
starts lying.

## Why this is not the leak ADR-0009 feared

ADR-0009's strongest objection was that a synced identity log would tell anyone
with the link how many devices a person uses and when they switched phones.

It already does. Every op ends with the HLC of the device that stamped it, and
an HLC's last field is the node id. Counting distinct node ids in a group's op
log has always been counting devices; watching a node id's ops change `actor`
has always been watching a phone change hands. Publishing the claim adds no new
signal — it makes an existing one legible, and puts a timestamp and a name on
something readers would otherwise have to reverse-engineer from clock suffixes.

The other objections stand as consequences rather than as reasons not to:

- **It is noise in the ledger.** It is not a money fact, and a busy identity
  history would clutter `/g/history`. In practice a device claims once and
  switches roughly never, so it is a handful of lines per group.
- **It cannot be retracted.** Clearing site data no longer erases the record
  that this phone said it was Sam — the group has it. That is the point: an
  attribution you can quietly erase is not an attribution.

## Consequences

- A device that has never claimed anybody writes no identity op. Nothing is
  published until you tell the app who you are.
- Identity revisions are never restorable — "restore" would mean telling
  somebody else's phone who it is. `/g/history` hides the control for them.
- Rows in the old device-local `identityLog` are dropped rather than migrated:
  they have no ops behind them, no HLCs, and no honest way to be published
  after the fact. The shared record starts at this deploy.
- `/g/options` still shows *this phone's* timeline, now read back out of the
  ops this device stamped rather than from a private table. The copy says the
  changes are in the group's history, because they are.
