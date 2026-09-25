# 0036 — The server cannot read a group

**Status:** Accepted · 2026-09-12

**Context.** Ops landed in D1 as plain JSON. The link secret was only a bearer
token, stored as `sha256(secret)`, so it kept other *users* out and the server
in: anyone with database access read every title, amount, name and note. For an
app whose pitch is "a group is a link, there are no accounts", the one asset is
that the link is the whole of the trust — and it wasn't.

## Decision

**The server stores ciphertext it has no key for.** Two independent values come
out of one HKDF-SHA256 over the link secret, salted with the group id
(`core/seal.ts`):

- **a token** (`info: "auth"`), sent as the bearer. The server stores
  `sha256(token)` exactly where it used to store `sha256(secret)`, so auth is
  unchanged in shape and the Worker has no variable called `secret`.
- **a content key** (`info: "content"`), AES-GCM-256, which never leaves the
  phone. Every op body is sealed under it.

What crosses the wire is an **envelope** — `{ id, groupId, sealed, seq }` — and
nothing else. The id is a random UUID and the idempotency key the server dedupes
on; the group id is the address. Everything that carries meaning, `patch` and
`actor` and `entity` and `hlc` and `note` included, is inside the seal. The
envelope is the AES-GCM additional data, so a body cannot be moved onto another
op or another group without every phone noticing.

The link itself does not change. The secret is the same ~83 bits in the URL
fragment ([0003](0003-link-only-access.md),
[0004](0004-static-export-and-offline.md)), and that fragment never reaching a
server is now what holds confidentiality rather than just access.

## Consequences

- **The server can never grow a feature that reads content.** Email digests, a
  public summary page, server-side folding — the door
  [0002](0002-append-only-op-log.md) left open is shut, and re-opening it means
  reversing this. Anything of that shape has to run on a phone that holds a key.
- **The D1 log was wiped once**, at the cutover on 2026-09-12: the old rows had
  no ciphertext and the old schema had no column for one. Phones re-offered
  their own logs sealed, because the op log on the phone is the truth and the
  server is a relay ([sync.md](../sync.md)). That was **the last wipe** — what
  is in D1 now is data
  ([standing-instructions.md](../standing-instructions.md#product)).
- **Shape still leaks.** The server sees how many ops a group has, when each
  arrived, roughly how long each is, and the IP that pushed it — and, relaying
  a notification, the endpoint it goes to, never stored
  ([0037](0037-a-notification-is-sealed-by-the-phone-that-caused-it.md)).
  Metadata is the price of a server that can route at all.
- **A receipt still leaves in the clear** — the scan is a passthrough to Gemini
  and the photograph is the thing being read
  ([scan-worker.md](../scan-worker.md#trust-and-what-were-accepting)). The about screen says so.
- **No rotation, no recovery.** There is no key to change without changing the
  link, and a link nobody kept was already an unrecoverable group
  ([0003](0003-link-only-access.md)).
- One `sealOp`/`openOp` pair in `lib/db/sync.ts` is the whole boundary. A second
  path to the server would be a second place to forget.

## Rejected

- **Public-key per member, with a key exchange.** Correct for strangers and for
  revoking one person; it needs an identity to address a key to, which
  [0003](0003-link-only-access.md) deliberately does not have. Whoever holds
  the link holds the group — so the link is the key.
- **A passphrase the group agrees on.** Real secrecy from whoever gets the
  link, at the cost of the thing the product is: tap a link, you're in.
- **Sealing only `patch`, leaving `entity`, `actor` and `hlc` readable** — it
  would keep server-side validation and per-entity queries. Neither is used,
  and "who edited what, when" is most of what a log gives away.
- **A slow KDF (PBKDF2, Argon2).** They defend a secret a person chose; this one
  is ~83 random bits, still far enough past brute force that the attack is the
  cipher and not the guess — but that is the number deciding it, so a shorter
  secret reopens this entry.
