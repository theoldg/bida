# 0037 — A notification is sealed by the phone that caused it

**Status:** Accepted · 2026-09-23

**Context.** A group is only as current as the last time somebody opened it,
and "Ana added the dinner" is the one piece of news worth a buzz. Web Push needs
no process alive on the phone: the OS keeps one connection to Google's or
Apple's push service and wakes the service worker on a message. iOS allows it
from 16.4, **only in a home-screen app**, which is where [ios.md](../ios.md)
already steers everybody. The obvious shape — a table of subscriptions per
group on the server, the server writing the text — is ruled out by
[0036](0036-the-server-cannot-read-a-group.md) twice: it cannot write text it
cannot read, and a table of endpoints per group is a stored map of which groups
share a phone.

## Decision

- **A device's subscription is a field on its `identity`.** `push: { endpoint,
  p256dh, auth, scope? } | null`, next to `memberId` — the device→member map
  [0003](0003-link-only-access.md) already publishes, merged per field like any
  identity op. No new entity kind, and it lives in the sealed log, so the server
  stores nothing about who is subscribed.
- **The phone that caused the change writes the notification, one per
  recipient device.** It holds the fold, so it knows each recipient's member
  and their share; it encrypts each text to that device's subscription
  (RFC 8291) and sends it once the ops that caused it have landed. That
  encryption is end to end between two phones, so no inner seal under the group
  key is needed.
- **The server is a relay that forgets.** `POST /api/groups/:id/notify`, 40 to
  a request so a group of any size fits the subrequest cap, signs a VAPID
  header and forwards each ciphertext to push services' own hosts. It stores no
  endpoint and returns each one's status; the sender clears a dead one
  (`404`/`410`) with an ordinary identity op.
- **How much a phone hears is the phone's setting** — entries its member is in,
  or everything — riding on the subscription as `scope`, so the sender filters.
  "Nothing" is no subscription. Absent reads as "own", and there is no screen
  for it yet.
- **Only a person's own command about an entry notifies**, never a sync by
  itself — heals, imports and re-offered logs go through the same pipe and are
  nobody's news.

## Consequences

- **Google and Apple learn who uses bida together.** Payloads are opaque to
  them, but pushes fanned out in the same instant to three devices say those
  three share a group, and they know whose devices those are. No delay blurs
  it. The first third party in the sync path. `/about` only says notifications
  are sealed too; this metadata is written down here, not there.
- **Every endpoint a phone ever had is readable by every link holder, for
  ever** — the log is append-only. Useless without our VAPID private key, and
  the relay only forwards to push services' own hosts.
- **The server sees endpoints in transit**, like IPs. Nothing logs them.
- **A notification leaves the seal on the lock screen** — the OS stores it,
  shows it, may mirror it to a watch.
- **Nothing reaches a Safari tab or an in-app browser**, and delivery is
  best-effort.
- **Rotating the VAPID key silences every phone** until each re-subscribes on
  its next start.

## Rejected

- **Subscriptions in D1, server fans out.** Simplest, and the server could
  filter and clean up by itself — at the cost of a stored cross-group device
  graph, the one thing a D1 leak or subpoena would then yield.
- **A content-free tickle; the service worker pulls and writes the text.**
  Receiver-side text needs the fold, the copy and the claim inside `sw.js`, and
  both platforms demand a visible notification for every push, so it cannot
  decide to stay quiet about an entry you are not in.
- **Random delay per recipient.** Blurs the timing Google and Apple see, never
  hides it, and makes the notification late for everyone.
- **Accounts, or a per-member key exchange** — the identity
  [0003](0003-link-only-access.md) declines. Push turns out to need a
  device→group map, not a person.
