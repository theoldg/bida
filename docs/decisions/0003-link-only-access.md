# 0003 — Link-only access, and a device's identity claim is an op

**Status:** Accepted · 2026-08-27 · identity section 2026-08-28

**Context.** The owner chose Tricount's model: a group is a secret URL, you pick
who you are, there is no sign-up. But every op carries `actor` — the member id
that made the change — and the whole history is built on it. The owner: *"the
edits should record who did it, and that's why i wanted to track the identity
changes, also on the public log."* Attribution only means something if you can
tell when a device started or stopped speaking for a member.

## Decision

**No accounts, no passwords, no email.** A group is `groupId` + a high-entropy
`secret`; anyone with the link has full read/write access.

- The secret is generated client-side (128 bits, `crypto.getRandomValues`).
- The server stores only `sha256(secret)` — a database leak hands out nothing.
- The client sends it as a bearer token over TLS.
- It lives in the **URL fragment**, never a path or query string, so it never
  reaches a server, an access log, or a `Referer`
  ([0004](0004-static-export-and-offline.md)).

**Claiming or switching identity is an op like everything else.** `EntityKind`
has `identity`; the entity id is the device's HLC node id and the patch is
`{ memberId, claimedAt }`. It folds into `GroupState.identities` — one row per
device — and renders on `/g/history` beside every other change. The actor of a
switch is the member the device spoke for a moment ago, because that is who made
it. `meByGroup` stays device-local as the pointer this phone reads; what is
published is *changing* it.

This publishes nothing that wasn't already public: every op ends with the HLC of
the device that stamped it, and an HLC's last field is the node id. Counting
distinct node ids has always been counting devices. The claim makes an existing
signal legible rather than adding one.

## Consequences

- Zero auth code, zero email infrastructure, zero recovery flow, no cost, and
  onboarding is "tap this link".
- **Losing the link loses the group.** Mitigated by the local IndexedDB copy and
  a "copy invite link" affordance, not by us storing anything for you.
- **Attribution is soft** — anyone in the group can act as anyone. Correct trade
  for friends splitting a holiday; wrong for a product with strangers in it.
- A device that has never claimed anybody writes no identity op.
- A claim cannot be retracted — clearing site data no longer erases the record.
  That is the point: an attribution you can quietly erase is not one.
- Identity ops are mild clutter in a money log: a device claims once and
  switches roughly never.
- Push notifications become awkward (no stable identity to target). Deferred.

## Rejected

- **Magic-link email accounts** — real cross-device identity, at the cost of an
  email provider, a session layer, and a sign-in wall in front of a link you
  just shared with a friend.
- **Passkeys** — good mobile UX, painful recovery, more upfront work.
- **Keeping the identity claim device-local** (the original ruling). It treated
  identity as a fact about a phone; it is what makes every other op readable,
  and the privacy it protected was already in the log.

**Revisit if** strangers enter a group or push notifications become required.
Both point at real identity, and both are a new ADR.
