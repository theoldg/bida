# Notifications

*For: whoever builds push notifications. **Status: designed, not built**
(2026-09-23); the plan is being built step by step, each marked when done. [The decision](#the-decision) is written as the ADR it becomes
once shipped — ADRs record built things ([decisions/](decisions/README.md)), so
it lives here until then, with [the plan](#the-plan) under it.*

## The decision

*Becomes ADR-0037, "A notification is sealed by the phone that caused it".*

**Context.** A group is only as current as the last time somebody opened it,
and "Ana added the dinner" is the one piece of news worth a buzz. Web Push needs
no process alive on the phone: the OS keeps one connection to Google's or
Apple's push service and wakes the service worker on a message. iOS allows it
from 16.4, **only in a home-screen app**, which is where [ios.md](ios.md)
already steers everybody. The obvious shape — a table of subscriptions per
group on the server, the server writing the text — is ruled out by
[ADR-0036](decisions/0036-the-server-cannot-read-a-group.md) twice: it cannot
write text it cannot read, and a table of endpoints per group is a stored map
of which groups share a phone.

**Decision.**

- **A device's subscription is a field on its `identity`.** `push: { endpoint,
  p256dh, auth } | null`, next to `memberId` — the device→member map
  [ADR-0003](decisions/0003-link-only-access.md) already publishes, merged per
  field like any identity op. No new entity kind, and it lives in the sealed
  log, so the server stores nothing about who is subscribed.
- **The phone that caused the change writes the notification, one per
  recipient.** It holds the fold, so it knows each recipient's member and their
  share; it encrypts each text to that recipient's subscription (RFC 8291,
  `aes128gcm`) and hands the server `(endpoint, ciphertext)` pairs alongside the
  ops that caused them. That encryption is end to end between two phones, so no
  inner seal under the group key is needed.
- **The server is a relay that forgets.** On `POST /ops` it stores the ops as
  now, then signs a VAPID header and forwards each ciphertext. It never stores
  an endpoint, returns each endpoint's status, and the sender clears a dead
  one (`404`/`410`) with an ordinary identity op.
- **How much a phone hears is the phone's setting**: nothing, entries its
  member is in (in the split, among the payers, a side of a transfer), or
  everything. It rides on the subscription as `scope`, so the sender filters
  (`wantsNotice`); "nothing" is no subscription. Default "own", and not in the
  UI yet (the owner's call, 2026-09-23).
- **Only a person's own command notifies**, never a sync push by itself — heals
  and re-offered logs go through the same pipe and are nobody's news.

**Consequences.**

- **Google and Apple learn who uses bida together.** Payloads are opaque to
  them, but pushes fanned out in the same instant to three devices say those
  three share a group, and they know whose devices those are. No delay is
  added to blur it (the owner's call, 2026-09-23). This is the first third
  party in the sync path; `/about` says so.
- **Every endpoint a phone ever had is readable by every link holder, for
  ever** — the log is append-only. Useless without our VAPID private key, and
  the relay only forwards to push services' own hosts.
- **The server sees endpoints in transit**, like IPs. Nothing logs them.
- **A notification leaves the seal on the lock screen** — the OS stores it,
  shows it, may mirror it to a watch.
- **Nothing reaches a Safari tab or an in-app browser**, and delivery is
  best-effort (Android's doze can delay it).
- **Rotating the VAPID key silences every phone** until each re-subscribes on
  its next start.

**Rejected.**

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
  [ADR-0003](decisions/0003-link-only-access.md) declines. Push turns out to
  need a device→group map, not a person.

## What is said

The title is the group's name. The body names the entry, which history does not
need to ([history-copy.ts](../apps/web/lib/history-copy.ts) says "this
expense" under a heading that already named it), and the second line is the
recipient's share. **No running balance** — the share is the news, the balance
is the app's. Strings live in `copy.notify`
([ADR-0033](decisions/0033-every-word-in-one-file.md)).

| Command | Notifies | Body |
|---|---|---|
| `addExpense` (expense or income) | Everyone in it but the author | Ana added "Dinner" · €42.00<br>Your share €10.50 |
| `editExpense`, money moved | Everyone in it before *or* after | Ana changed the amount of "Dinner": €40.00 → €42.00<br>Your share €10.00 → €10.50 |
| `editExpense`, only title, date, category, note or photos | Nobody | — |
| `deleteExpense` | Everyone who was in it | Ana deleted "Dinner" · €42.00<br>Your share was €10.50 |
| `recordSettlement`, `editSettlement`, `deleteSettlement` | The two sides | Bo paid you €20.00 · Bo recorded that you paid them €20.00 |
| `convertTo*` | As an edit | Ana turned "Dinner" into a transfer |
| Heals, members, rates, identity, group rename | Nobody | — |

A payer gets both halves: "You paid €200.00 · your share €19.00", the share
being what of it was spent on them (none when they aren't in the split). Of
an entry you aren't in, a phone set to everything gets the first line alone.

"Money moved" is `describe()`'s own question: amount, currency, split, payers
or kind among the changed fields. One field gets its sentence, several get "Ana
edited "Dinner"" — the share line carries the meaning. A person removed from the
split reads "Your share €10.00 → none".

**One push, one notification per phone.** Five entries added offline arrive as
"Ana added 5 entries" over the sum of the shares in the group's currency. Each
notification is `tag`ged with the group id, so a group's latest replaces its
last. Tapping opens `/g/entry?id=&e=` for one entry, `/g?id=` for several or a
delete, where the new-edits line already folds what changed.

## The plan

Each step is one commit and leaves `pnpm check` green. Nothing sends anything
until step 6.

1. **core: `push` on identity.** *Built.* Accept the field in `validateOp` and the fold;
   `history.ts` and `history-copy.ts` skip a revision that moved only `push`,
   and so does the new-edits line (`components/new-edits.tsx`). Check
   [invariants.md](invariants.md) — nothing there should read it. Tests: fold
   merges `push` and `memberId` independently.
2. **core: `webpush.ts`.** *Built.* RFC 8291 `aes128gcm` encryption (ECDH P-256, HKDF,
   AES-GCM) on `globalThis.crypto` like `seal.ts`, and VAPID's ES256 JWT for
   the Worker. Tests against the RFC 8291 appendix vectors. No dependency.
3. **core: who hears what.** *Built* — `notify.ts`. A pure
   `notices(before, after, ops, me)` over the two folds a command sees and its
   own ops → one `Notice` per member but `me`, flagged `involved`: facts, not words — the
   change, the entry before and after at today's rates, that member's share
   and what they paid (both base minor units, cent placed as `computeBalances`
   places it), and which money fields moved. Words and the url are step 6's,
   from `copy.notify`, so core stays copy-free. A mode swap meaning the same
   split, or a rate the same command moved, is no news.
4. **api: the relay.** `POST /ops` takes an optional `notify: [{ endpoint,
   body }]` (base64 ciphertext, ≤ 4 KiB each, a count under the free plan's
   subrequest cap — re-check it, D1 calls may count). After the ops commit it
   forwards them in parallel, only to push services' own hosts
   (`fcm.googleapis.com`, `*.push.apple.com`,
   `updates.push.services.mozilla.com`, `*.notify.windows.com`), and answers
   with `notified: { [endpoint]: status }` — awaited rather than
   `ctx.waitUntil`, because the sender needs the statuses, with a short
   timeout so a slow push service costs the sync a second at most. VAPID keys
   are Worker secrets per environment; the public half reaches the build as an
   env var. Caps belong in `push-limits.ts`.
5. **web: subscribe.** One setting per phone (`device`), default "own",
   written as `scope` into every held group's identity `push`. Asks
   permission from the tap (iOS requires it), `pushManager.subscribe`, writes
   the identity's `push`. Hidden where it cannot work — a Safari tab on iPhone
   says to add to home screen. On every start, compare `getSubscription()`
   with each held group's identity and rewrite on a change, since Safari
   rotates without saying. `sw.js` gains `push` (show) and
   `notificationclick` (focus or open the url).
6. **web: send.** The commands in the table store their notices in a Dexie
   `notices` table keyed by the op ids that caused them, in the same
   transaction as `appendOps`. `syncGroupOnce` attaches a round's notices to
   its push, encrypts at send time against the subscriptions the fold holds
   then, and deletes them on a 2xx. A `404`/`410` endpoint gets an identity
   op setting `push: null`. A healed or pulled op never has a notice, so it
   never sends one.
7. **web: leaving.** `forgetGroup` writes `push: null` before hiding, and
   `syncAll` pushes a left group's pending ops once (today it skips them) —
   the key outlives forgetting, so this is possible. A push that arrives
   before that op lands is still shown — both platforms demand it, and iOS
   revokes a subscription that stays silent.
8. **docs.** Move [the decision](#the-decision) to `decisions/0037-…`, edit
   [ADR-0003](decisions/0003-link-only-access.md)'s "awkward, deferred" and
   "Revisit if" lines and ADR-0036's "Shape still leaks", add the Google/Apple
   sentence to the privacy section of `/about`, a phone-checklist entry in
   [testing.md](testing.md#what-only-a-phone-can-check) (a headless browser
   cannot receive a push), and cut this file down to what was built.

**Next:** step 4, the relay. Its keys are set up by hand once per
environment — [hosting.md](hosting.md#deploying) has the commands — and the
two public halves land in `wrangler.toml` with it.

**Open for the owner:** how a phone first asks permission while the setting
isn't in the UI — iOS allows the prompt only from a tap.
