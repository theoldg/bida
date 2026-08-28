# 0003 — Link-only access, no user accounts

**Status:** Accepted · 2026-08-27

**Context.** The owner chose Tricount's model: a group is a secret URL, you pick
who you are, there is no sign-up.

**Decision.** No accounts, no passwords, no email. A group is `groupId` + a
high-entropy `secret`; anyone with the link has full read/write access.

- The secret is generated client-side (128 bits, `crypto.getRandomValues`).
- The server stores only `sha256(secret)` — a database leak hands out nothing.
- The client sends it as a bearer token over TLS.
- It lives in the **URL fragment**, never a path or query string, so it never
  reaches a server, an access log, or a `Referer`
  ([0004](0004-static-export-fragment-routing.md)).
- "Which member am I" is device-local and never synced (though *changing* it is
  an op — [0011](0011-identity-changes-are-public.md)).

## Consequences

- Zero auth code, zero email infrastructure, zero recovery flow, no cost, and
  onboarding is "tap this link".
- **Losing the link loses the group.** Mitigated by the local IndexedDB copy and
  a "copy invite link" affordance, not by us storing anything for you.
- **Attribution is soft** — anyone in the group can act as anyone. Correct trade
  for friends splitting a holiday; wrong for a product with strangers in it.
- Push notifications become awkward (no stable identity to target). Deferred.
- Anyone with the link can restore any revision. Flagged as an open product
  question.

## Rejected

- **Magic-link email accounts** — real cross-device identity and attribution, at
  the cost of an email provider, a session layer, and a sign-in wall in front of
  a link you just shared with a friend.
- **Passkeys** — good mobile UX, painful recovery, more upfront work.

**Revisit if** strangers enter a group or push notifications become required.
Both point at real identity, and both are a new ADR.
