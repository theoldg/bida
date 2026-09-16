# 0003 — Link-only access, and a device's identity claim is an op

**Status:** Accepted · 2026-08-27 · identity 2026-08-28 · shorter ids 2026-09-16

**Context.** The owner chose Tricount's model: a group is a secret URL, you pick
who you are, there is no sign-up. But every op carries `actor`, and the whole
history is built on it — *"the edits should record who did it … also on the
public log."* Attribution only means something if you can tell when a device
started or stopped speaking for a member.

## Decision

**No accounts, no passwords, no email.** A group is `groupId` + a high-entropy
`secret`; anyone with the link has full read/write access.

- The secret is generated client-side (`crypto.getRandomValues`): 16 base36
  characters, ~83 bits and not the 128 the byte count suggests, because a base36
  character carries log2(36). Unguessable at any rate this server answers, and
  the margin the single-pass HKDF in `core/seal.ts` rests on.
- The server never receives it: the bearer is a token derived from it, and the
  key that opens the ops is the other branch of that derivation
  ([0036](0036-the-server-cannot-read-a-group.md)). A database leak hands out a
  hash of the token and a pile of ciphertext.
- It lives in the **URL fragment**, never a path or query string, so it never
  reaches a server, an access log, or a `Referer`
  ([0004](0004-static-export-and-offline.md)).
- **The id is 12 base36 characters** (`newGroupId()`), ~62 bits — the link is
  the product's onboarding, so the id pays for its length in what people paste,
  and a UUID spent 36 characters on what 12 do. Minted offline with nobody to
  ask whether it is taken, so it is a birthday bet: a million groups collide
  with probability ~1 in 10 million, and a collision costs the second group its
  sync — never the first group's contents, which take the secret to read. The
  same 62 bits keep the row unguessable, which is what stops a stranger
  registering a group's id before it first pushes. Groups made before this
  carry a UUID and keep it; nothing anywhere reads an id's shape.

**Claiming or switching identity is an op like everything else.** `EntityKind`
has `identity`; the entity id is the device's HLC node id and the patch is
`{ memberId, claimedAt }`. It folds into `GroupState.identities` and renders on
`/g/history`. The actor of a switch is the member the device spoke for a moment
ago, because that is who made it. `meByGroup` stays device-local as the pointer
this phone reads; what is published is *changing* it. This publishes nothing new
— every op ends with an HLC whose last field is the node id, so counting devices
was always possible. The claim makes an existing signal legible.

## Consequences

- Zero auth code, zero email infrastructure, zero recovery flow, and onboarding
  is "tap this link".
- **Losing the link loses the group** — now literally: nobody, us included, can
  read a group without its secret. Mitigated by the local IndexedDB copy and a
  "copy invite link" affordance, not by us storing anything for you.
- **On iPhone that local copy is weak.** A Safari tab evicts it after a week
  unused, and nothing without an account can carry it into the home-screen
  app, so onboarding there is a link *and* a choice about where to keep it
  ([ios.md](../ios.md)).
- **Attribution is soft** — anyone in the group can act as anyone. Correct trade
  for friends splitting a holiday; wrong for a product with strangers in it.
- A claim cannot be retracted; clearing site data no longer erases the record.
  That is the point — an attribution you can quietly erase is not one.
- Push notifications become awkward (no stable identity to target). Deferred.

## Rejected

- **Magic-link email accounts** — real cross-device identity, at the cost of an
  email provider, a session layer, and a sign-in wall in front of a link you
  just shared with a friend.
- **Passkeys** — good mobile UX, painful recovery, more upfront work.
- **Keeping the identity claim device-local** (the original ruling) — it treated
  identity as a fact about a phone, when it is what makes every other op
  readable, and the privacy it protected was already in the log.

**Revisit if** strangers enter a group or push notifications become required.
Both point at real identity, and both are a new ADR.
