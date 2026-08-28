# 0011 — A device's identity claim is an op, so `actor` can be read

**Status:** Accepted · 2026-08-28 · **Supersedes [0009](0009-identity-is-device-local.md)**

**Context.** Every op carries `actor` — the member id that made the change — and
the whole history UI is built on it. The owner: **"the edits should record who
did it, and that's why i wanted to track the identity changes, also on the
public log."** `actor` is only meaningful if you can tell when a device started
or stopped speaking for a member. A phone that was Sam and is now Marie produces
ops attributed first to one then the other, and with the claim hidden nothing
explains the seam — attribution recorded but not *auditable*, which is the part
that matters when someone asks "I didn't change that, who did?".

**Decision.** Claiming or switching identity is an op like everything else.
`EntityKind` gains `identity`; the entity id is **the device's HLC node id** and
the patch is `{ memberId, claimedAt }`. It folds into `GroupState.identities` —
one row per device — and renders on `/g/history` beside every other change. The
actor of a switch is the member the device spoke for a moment ago, because that
is who made it. `meByGroup` stays device-local as the pointer this phone reads;
what changed is that *changing* it also appends an op. The device-local
`identityLog` table is gone (Dexie v3) — two logs of the same thing is how one
of them starts lying.

**Why this isn't the leak 0009 feared.** It already leaks. Every op ends with
the HLC of the device that stamped it, and an HLC's last field is the node id:
counting distinct node ids has always been counting devices, and watching a node
id's ops change `actor` has always been watching a phone change hands.
Publishing the claim adds no signal — it makes an existing one legible.

## Consequences

- A device that has never claimed anybody writes no identity op. Nothing is
  published until you tell the app who you are.
- A device that claimed somebody before this shipped publishes it once on next
  launch (`publishExistingClaims`), with `claimedAt` set to publication time. A
  late timestamp is honest; an invented one would not be.
- It cannot be retracted — clearing site data no longer erases the record. That
  is the point: an attribution you can quietly erase is not an attribution.
- Identity revisions are never restorable ("restore" would mean telling someone
  else's phone who it is); `/g/history` hides the control for them.
- Old `identityLog` rows are dropped, not migrated: no ops behind them, no HLCs,
  no honest way to publish them after the fact. The shared record starts here.
- It is not a money fact, so it is mild clutter in the ledger's history — in
  practice a handful of lines per group, since a device claims once and switches
  roughly never.
