# Live reads

*For: anyone reading from Dexie, or chasing a screen that sits on its skeleton
rows. Part of the [frontend](frontend.md) docs. `pnpm stall`
([browser-checks.md](browser-checks.md#pnpm-stall--a-read-of-this-phones-database-that-dies))
drives what this doc describes, and [`/diag`](diag.md) is how a phone reports
it.*

## A live read can die

Dexie's `liveQuery` swallows two error names — `DatabaseClosedError` and
`AbortError` — rather than delivering them. It means to ignore a query it
superseded itself; it also ignores one the *browser* killed, and those arrive
by the same door. An installed Android app is frozen when backgrounded and its
in-flight IndexedDB transactions are aborted; Chrome force-closes the
connection under storage pressure. Either way nothing is emitted — no value, no
error — and the subscription is then **dead**: the querier is never run again,
not even by a write to the table it reads. A screen reads "no value yet" as
"still loading", so the app sits on its skeleton rows until relaunched.

`lib/db/live.ts` is why **every live read goes through `useLive`**. A dead
subscription cannot be revived, so three things make a new one: the connection
closing (`db.on('close')`), the app returning to the foreground, and a read
that has returned nothing for 6s — twice, and then the notice in `Screen` says
so and offers the retry. `db.on('blocked')` feeds the same notice a different
sentence: an upgrade held open by another copy of the app never resolves on its
own, because `indexedDB.open` has no timeout and Dexie's handler only logs.

**A read can also be alive and queued.** An IndexedDB lock belongs to the
origin, not to the page: a readwrite transaction that another copy of the app
(a forgotten tab, a window left behind by an update) was frozen half way
through holds it, and every read of those stores waits, in every copy.

**The lock is per store, and that is the whole diagnosis.** Which reads hang
names the transaction holding it, because no two writes here take the same
scope: `device` alone is `updateDevice`, `ops`+`groupKeys`+`device` is the sync
commit, every entity table is `rebuild`, and all of it at once is `appendOps`.
A groups list on skeleton rows while the op log counts fine is an
`updateDevice` lock: every list and group screen reads `device`. `/diag`'s
`stores:` line names which stores are waiting.

No page can break another's lock, so three things limit it. **A hidden copy
touches the database at all** — neither half, because either one frozen
mid-transaction strands a lock the whole origin then queues behind.

*Writes* wait for the front: `whenVisible` in `lib/db/visible.ts`. What must *not* wait is a
write holding something that exists nowhere else: `saveGroupKey` stores an
invite's secret, and a tab killed while parked would lose the group.

*Reads* answer from memory: the gate in `useLive`'s querier. This half is the
one nothing in the app asks for, because **Dexie asks for it**. Every write
broadcasts itself to every other copy on the origin
(`BroadcastChannel('x-storagemutated-1')` → `propagateLocally` →
`signalSubscribersNow`) and each re-runs the queriers that read the tables that
moved — so the copy in front of you makes a *backgrounded* copy open a readonly
transaction across half the schema every time you save. On Android that is not
a race but a certainty: a tab and the installed app cannot both be in the
foreground, so one is always freezable and the other pokes it on every write,
and the next `appendOps` queues behind readonly locks nobody will ever release.
A hidden querier therefore returns its `remembered` answer and opens nothing;
Dexie sees a querier that observed no table, stops signalling it, and coming
back to the front bumps `epoch` and starts every read again for real. The
watchdog is held shut with it — a background page has nobody waiting on it, and
its last probe would `reopen()` the connection.

`useLive` remembers each read's last answer by
name and deps for the life of the page, so a screen opened during the wait
shows that instead of skeleton rows — while still counting as waiting, so the
notice stands. And the last probe, and the notice's button, open a fresh
connection (`db.reopen`), the one lever a page has on a stuck backend of its
own. `/diag`'s `copies:` line names every copy the service worker can see, and
whether it is hidden.

`ReadErrorBoundary` (app/layout.tsx) catches the rest. `dexie-react-hooks`
reports a failed read by throwing during render; without a boundary every error
`liveQuery` does *not* swallow is a white screen.

**A querier must never resolve `undefined`.** That is the one value `useLive`
cannot read, because it is how `useLiveQuery` says "no answer yet": a read that
legitimately has nothing to report has to say `null` — a group with no key row
(the demo, permanently) would otherwise be a read that never answers.
`pnpm demo` waits out the watchdog to hold that one.

`pnpm stall` drives both halves in a browser; `lib/db/live.test.ts` pins the
Dexie behaviour itself, so an upgrade that fixes it tells us.

## Gotchas

- **A read that never answers is indistinguishable from a slow one.** Both are
  `undefined`, and nothing in Dexie times out — not `indexedDB.open`, and not a
  `liveQuery` whose error was swallowed. Every screen that draws a skeleton
  needs something that eventually stops believing it
  ([A live read can die](#a-live-read-can-die)).
