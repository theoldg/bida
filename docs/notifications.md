# Notifications

*For: whoever touches push notifications. Why they work this way is
[ADR-0037](decisions/0037-a-notification-is-sealed-by-the-phone-that-caused-it.md):
the phone that made a change encrypts one notification per listening device,
and the Worker relays them without keeping anything. Seen working on dev
2026-09-23: an edit from an incognito tab reached the owner's installed app.
The rest of the [checklist](testing.md#what-only-a-phone-can-check) is unrun.*

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
| `restoreEntry` | As an add | Ana restored "Dinner" · €42.00<br>Your share €10.50 |
| `recordSettlement`, `editSettlement`, `deleteSettlement` | The two sides | Bo paid you €20.00 · Bo recorded that you paid them €20.00 |
| Heals, members, rates, identity, group rename | Nobody | — |

A payer gets both halves: "You paid €200.00 · your share €19.00", the share
being what of it was spent on them (none when they aren't in the split). Of
an entry you aren't in, a phone set to everything gets the first line alone.

"Money moved" is `describe()`'s own question: amount, currency, split, payers
or kind among the changed fields. One field gets its sentence, several get "Ana
edited "Dinner"" — the share line carries the meaning. A person removed from the
split reads "Your share €10.00 → none".

**One push, one notification per phone.** Five entries added offline arrive as
"Ana added 5 entries" over the sum of the shares in the group's currency; any
other mix is "Ana changed 3 entries", and one entry's several commands read as
its latest. Each
notification is `tag`ged with the group id, so a group's latest replaces its
last. Tapping opens `/g/entry?id=&e=` for one entry, deleted or not — a
deleted one's screen is where Restore is — and `/g?id=` for several, where the
new-edits line already folds what changed. The tap usually
beats the sync that brings the entry in, so an entry screen missing its entry
shows "Fetching the latest…" through one sync of the group, and says "Gone"
only if it is still missing after.

## How it works

- **Subscribing** (`lib/push.ts`). The installed app offers it where the install
  card stood, on the groups list and each ledger
  ([ios.md](ios.md#the-card--the-groups-list-and-the-ledger)); the tap asks
  permission before any await, which iOS requires. The subscription is written
  as `push` on this phone's identity in every held, claimed group. The VAPID
  public key comes from `GET /api/push/key`, since one build serves both
  Workers. Every start and every claim runs `reconcilePush`, which rewrites a
  rotated or new-key subscription, writes `null` for a revoked permission,
  keeps what is there when offline, and writes nothing when the log agrees.
- **Keeping** (`appendOps`'s `notify`, passed only by `commands/entries.ts`).
  core's `notices` runs against the log just before and after the command and
  what it finds goes in the Dexie `notices` table with the op ids, in the same
  transaction. Skipped when nobody else in the group has a subscription, since
  it folds the log twice.
- **Sending** (`sendNotices`, `lib/db/sync.ts`), after a sync's rounds, for
  every record whose ops have all landed: `lib/notify-copy.ts` words one
  payload per subscribed device but this one, `encryptPush` seals each, and
  `/notify` takes them 40 at a time ([sync.md](sync.md)). Records go once every
  batch is answered; a network error or a 5xx keeps them for the next run. A
  `404`/`410` endpoint the log still holds gets `push: null`, written by the
  sender. A failure is a `/diag` line, never a failed sync.
- **The relay** (`apps/api/src/relay.ts`) forwards only to push services' own
  hosts, signs one VAPID JWT per service with the request's origin as subject,
  and gives up after 1 s. `0` in its answer means not delivered for a reason
  that isn't the subscription's — never a reason to clear one.
- **Showing** (`public/sw.js`) — always something, as both platforms demand;
  `renotify`, so a group's latest replaces its last and still buzzes; a tap
  focuses or opens the url, kept same-origin.
- **Leaving** (`forgetGroup`) writes `push: null` first, and `syncAll` keeps
  syncing a left group until its pending ops are out. That sync heals nothing:
  forgetting drops the claim. Rejoining puts the subscription back.
- **Not built:** a screen for `scope` ("everything" is readable, never written).

## Gotchas

- **Headless Chromium cannot subscribe**, permission granted or not — the
  browser checks stop at the card; the rest is the phone checklist.
- **The free plan's 50 subrequests per invocation** is from memory (Cloudflare's
  page was unreachable 2026-09-23). The batch of 40 sits under it; confirm
  before raising it.
