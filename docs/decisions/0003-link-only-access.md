# 0003 — Link-only access, no user accounts

**Status:** Accepted · 2026-08-27

## Context

The owner chose Tricount's model: a group is a secret URL, you pick who you are,
and there is no sign-up. The alternative offered was magic-link email accounts.

## Decision

No accounts, no passwords, no email. A group is identified by
`groupId` + a high-entropy `secret`. Anyone with the link has full read/write
access to that group.

- The secret is generated client-side (128 bits, `crypto.getRandomValues`).
- The server stores only `sha256(secret)` and compares hashes. A database leak
  does not hand out group access.
- The client sends the secret as a bearer token over TLS.
- The secret lives in the **URL fragment**, never a path or query string, so it
  is never sent to any server, never lands in an access log, and never leaks via
  `Referer` ([0004](0004-static-export-fragment-routing.md)).
- "Which member am I" is a device-local setting, never synced.

## Consequences

- Zero auth code, zero email infrastructure, zero recovery flow, no cost.
- Instant onboarding — the whole friction is "tap this link".
- **Losing the link loses the group.** Mitigated by the local copy in IndexedDB
  and a "copy invite link" affordance; not by us storing anything for you.
- **Attribution is soft.** Anyone in the group can act as anyone. For a group of
  friends splitting a holiday this is the correct trade; it would not be for a
  product with strangers in it.
- Push notifications become awkward (no stable identity to target). Deferred.
- Anyone with the link can restore any revision. This follows from the above and
  is flagged as an open product question.

## Rejected

- **Magic-link email accounts** — a reliable cross-device "me" and real
  attribution, at the cost of an email provider, a session layer, and a sign-in
  wall in front of a link you just shared with a friend.
- **Passkeys** — good mobile UX, painful recovery, more upfront work.

## Revisit if

Strangers ever enter a group, or push notifications become required. Both point
at real identity, and both are a new ADR rather than a patch to this one.
