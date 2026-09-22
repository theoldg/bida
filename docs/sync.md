# Sync, offline, and version history

*For: anyone touching the op log, the sync engine, or history UI.* These are one
subject: the log that syncs is the log that renders history.

## The operation

```ts
type Op = {
  id: string        // client UUID; the idempotency key
  groupId: string
  entity: 'group'|'member'|'expense'|'settlement'|'attachment'|'identity'|'rate'
  entityId: string
  kind: 'create' | 'update' | 'delete' | 'restore'
  patch: Record<string, unknown>   // an entry: the whole entity. Anything else: changed fields
  hlc: string       // hybrid logical clock
  actor: string     // memberId
  note?: string     // optional human reason, surfaced in history
  createdAt: number // wall clock, display only — NEVER for ordering
  seq?: number      // assigned by the server; absent = unsynced
}
```

**An entry is written whole; everything else is written per field.** An expense
or transfer op carries the entity as the person saving it saw it, and the
highest HLC wins all of it — so the version everybody ends up looking at is one
somebody actually read, rather than an amount from one phone beside a split from
another that does not sum to it
([ADR-0002](decisions/0002-append-only-op-log.md)). A `member`, `rate`,
`identity` or `group` op still carries only what changed, so concurrent edits to
different fields of those both survive.

Two fields never ride along on a content save, and the repairs in
[invariants.md](invariants.md) depend on it:

- **`deletedAt` merges per field.** A whole write carries whatever lifecycle the
  saving device believed, so a save made offline would undo a tombstone, or
  re-apply one a healer had just lifted.
- **`createdAt` is write-once**, held in the fold by `WRITE_ONCE_FIELDS` rather
  than hoped for, because every whole write carries one.

**The command layer is what makes that true.** `editExpense` and
`editSettlement` build the entity from the stored row plus the form, re-derive
`rateToBase` and `baseAmountMinor` from the registry rather than carrying them,
and append the lot. A save that moved nothing still writes nothing
(`movesAnything` in `commands/patch.ts`), or every Save would be a revision
saying nothing happened.

**A merge is the only thing that can make the state illegal**, so `syncGroup`
heals right after it rebuilds: `healGroup` runs the registry to a fixed point
and puts this phone's own member back if the merge removed them
([invariants.md](invariants.md)). It writes ordinary ops, which the next run
pushes. A phone that hasn't claimed a member heals nothing — it has no honest
name to sign with — and a forgotten group is never reached at all, which is
what keeps a restored member from being an argument that runs forever.

**A `create` writes no field it would only be defaulting.** The fold treats
absent as the default, so `receiptItems: null` on an expense nobody scanned is
bytes in the log and a row in its own history saying nothing changed. `only()` in
`apps/web/lib/db/commands/patch.ts` drops them. The exception is a `rate` create:
its entity id is the currency code, so setting a rate the group had cleared
lands on the tombstoned row and must write `deletedAt: null` to lift it. In an
`update` an absent field means "leave it alone", so clearing one there still
writes the null.

A `rate` op is the odd one: its `entityId` is the currency code rather than a
generated id, because the group holds one rate per currency and everyone has to
land on the same row ([ADR-0005](decisions/0005-money-and-currency.md)). Two
people typing a EUR→MAD rate offline therefore *conflict*, per-field LWW, which
is the point — one number, last word wins, both ops in the history.

## Ordering: hybrid logical clocks

Phone wall clocks are wrong, sometimes by minutes; ordering by `createdAt` lets
a slow clock silently lose every conflict. HLC (`core/hlc.ts`) is
`<physical-ms>-<counter>-<nodeId>`, zero-padded so string comparison equals
causal-ish ordering. On send: `physical = max(now, lastPhysical)`, incrementing
`counter` on a tie. On receive: `max` with the remote physical. `nodeId` is
a random per-device string breaking ties deterministically.

**Receiving is what makes the ordering true**, so `hlcReceive` runs over every
pulled op, in the same transaction that stores them — a device that has seen a
stamp always stamps after it. Skip that and the clock only moves on send: a
peer whose phone runs three hours fast wins every conflict, because the
correction you type after reading their op stamps *before* it and the fold
throws it away.

**A stamp up to a day ahead is adopted; one further ahead waits.** A fast phone
is still somebody's expense, but one set to 2099 would pin every clock it met
to 2099. So an op stamped more than `MAX_DRIFT_MS` past this phone's wall is
held back like an unreadable one (`isAhead`), neither folded nor adopted, with
the moment it stops being ahead as `unreadable.retryAt` — a clock merely fast
is late, not lost. A phone's own clock found beyond the bound starts again from
the wall, since every peer would refuse what it stamped. A stamp no clock
writes at all — the wrong shape, or past the year 5138 — is refused by
`validateOp` (`isHlc`), and a full counter carries into the millisecond rather
than throwing.

**Order by HLC, never by `seq` and never by `createdAt`.** `seq` orders arrival
at the server and answers only "what have I not pulled yet".

## Folding

Sort by `hlc` ascending, then per entity: `create` initialises; `update` assigns
each field in `patch` — **last write wins by HLC**, over the whole entity for an
entry and per field for everything else; `delete` sets
`deletedAt` and never removes the row; `restore` applies exactly like an update
— nothing emits one
([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)), but groups
in production hold them.

The fold is pure and total: any subset of ops produces *some* valid state. An
`update` arriving before its `create` yields a partial entity that completes
later. Don't throw on out-of-order ops.
[ADR-0002](decisions/0002-append-only-op-log.md) for why LWW and not a CRDT.

## The protocol

Two endpoints — `apps/api/src/index.ts` (routes), `store.ts` (D1), `auth.ts`
(bearer check). Both authenticate with a **token derived from the group secret**
([ADR-0003](decisions/0003-link-only-access.md),
[ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)); the secret itself
never leaves the phone.

**An op crosses the wire sealed.** What is sent is an envelope —
`{ id, groupId, sealed, seq }` — where `sealed` is the rest of the op encrypted
under the other branch of the same derivation (`core/seal.ts`). `id` is the
idempotency key and `groupId` the address, so those two are what routing needs
and all it gets.

**`POST /api/groups/:id/ops`**
```jsonc
// → { "ops": [ /* unsynced SealedOp[], no seq */ ], "since": 412 }
// ← { "assigned": { "<opId>": 413 }, "ops": [ /* seq > 412, unseen */ ],
//     "latestSeq": 419 }
```
A push carries up to fifty queued ops, and a phone with more sends rounds until
its queue is empty — what got through stays through, rather than a fortnight's
backlog riding on one request. The accept cuts the batch up again on its own
side, so no clause outgrows D1's hundred bound parameters whatever the phone
sends — see the gotcha below. Accepting is idempotent on `Op.id`, which is what makes retry
safe on a flaky connection — a retry re-seals under a fresh IV, so the two ciphertexts differ
and the id is what says they are one op. **There is no create-group endpoint**:
a group's first push registers it, storing `sha256(token)` from that request,
and every later request is checked against it. A `GET` on a never-pushed group
returns 404 — the creating device must sync once before an invite link is
pullable.

**`GET /api/groups/:id/ops?since=N`** — the same pull, without a push.

### The push has a ceiling

**This is the one door that registers its own credential.** There is no
create-group endpoint, so a first push stores whatever token hash it arrives
with — meaning the bearer gates a stranger out of *someone else's* group and
nothing else. Anyone can mint group ids, and the log they write into is finished
data that gets no further resets
([standing-instructions](standing-instructions.md#product)).

So a push is capped three ways (`apps/api/src/push-limits.ts`): **16 MB of
body**, **5 000 ops**, and **256 KB of ciphertext per op**. The body is refused
on `content-length` before it is read, and the other two after the envelope
parses, because a declared length is only the caller's claim. All three answer
`413`.

Every number sits deliberately far above honest traffic — the largest op anyone
can produce is an expense repeating a scanned bill's item array, about 30 KiB
sealed, and the client pushes fifty at a time. They are **abuse ceilings, not
protocol limits**: a tight one is worse than the flood it prevents, because a
phone refused a `413` retries the identical body forever and the server cannot
make an old build chunk differently. That is the same reasoning that keeps D1
batching on the server's side of the door (the gotcha below).

**They bound one request, not a campaign**, and that is where it stops. A
counter per caller is the obvious next move and the owner has declined it:
counting callers means keeping a row about each one, which is
the one thing a server that cannot read a group should not start doing, and
the ceilings above already sit far enough over honest traffic that a flood
hits Cloudflare's own limits first. A `429` from the platform costs a quiet
day; a table of who pushed what costs the promise.

### Deleting a group

**`DELETE /api/groups/:id`** — every op of that group, and the group with them.
The one destructive endpoint, authenticated like the other two: whoever holds
the link is the group, so whoever holds the link can end it
([ADR-0003](decisions/0003-link-only-access.md)). It is asked for from
`/delete-my-data` ([frontend.md](frontend.md#deleting-a-group)) and from nowhere
else.

**What is left is a tombstone**, not an absent row: `groups.deleted_at` set, the
token hash blanked, the ops gone (`0003_group_tombstone.sql`). Deleting the row
outright would last until the next phone that still held the link pushed its
local log back, which registers the id afresh — the deletion would undo itself,
silently, and the screen promising otherwise would be lying. So the id is spent
for good, and `last_op_seq` stays where it was so nothing can ever be handed a
deleted op's sequence number.

**Every endpoint answers 410 for it**, before the token is checked, since there
is no longer a token to check against. A phone meeting that 410 erases its own
copy of the group (`eraseGroupLocally`) and writes the id to
`device.deletedGroups`, which is what the group screen and `/join` read to say
the group was deleted rather than showing a group that quietly vanished. That is
the only thing in this app that removes data instead of appending an op saying
it was removed — [ADR-0002](decisions/0002-append-only-op-log.md) names it as
its one exception.

## The sync engine

`apps/web/lib/db/sync.ts`, which is also **the boundary the plaintext stops
at**: ops are plain in Dexie and on every screen, and the `sealOp`/`openOp` pair
in `pushPullGroup` is the whole of why the server holds ciphertext. A pulled op
is opened before anything is stored, so a run never half-applies. One that will
not open is skipped rather than fatal — it is counted on the group key and
printed on `/diag` — since the same row comes back on every retry and would
wedge the group for good. What mints one is a newer build — a new entity or op kind,
or a second seal format — so `openOp` turns anything wrong with an opened row
into a `SealError`, the one error the pull skips. The cursor moves past a
skipped op, so the record carries `fromSeq` and the build that skipped it, and
the first run of any other build — or the first past `retryAt` — pulls again
from `fromSeq - 1`: a row nothing can read costs a re-pull per deploy. A single-flight loop triggered by a local write
(debounced ~1 s), `visibilitychange` → visible, `online`, and a 60 s interval
while foregrounded. Backoff 2/4/8 s capped at 60 s, reset on success. Never
block the UI; never let two runs overlap — `syncAll` is single-flight over the
whole run and `syncGroup` over one group, and an overlapping call gets back the
promise already in flight. Both guards are needed: opening a group syncs it
directly, and without the per-group guard that races the loop into pushing and
pulling the same ops twice and taking the `rebuild()` lock twice. A run that attempted nothing must never conclude "no
failures" and reset a backoff the failing run had grown. **Nothing writes while
the app is hidden:** no run starts, and a response that lands after the app
went to the background waits for it to come back before its transaction opens
(`parked` on `/diag`) — a phone freezes a hidden app, and a transaction frozen
half way keeps its lock. The rule is the app's, not sync's: `lib/db/visible.ts`
([frontend.md](frontend.md#a-live-read-can-die)).

### The demo group has no key

**`runSyncAll` drives off `groupKeys.toArray()`, and `syncGroupOnce` returns
early when there is no key row.** So a group created without `saveGroupKey` is
*structurally* incapable of reaching the server: there is no flag to flip and
no path to disable. That absence is the whole of the demo group
([product.md](product.md#the-mvp)) — it is otherwise an ordinary group of
ordinary ops, and nothing downstream of the fold knows the difference.

This is load-bearing, not tidiness. `POST /ops` registers any unseen group id
and has no budget, the D1 log gets no further resets
([implementation-status.md](implementation-status.md#what-is-open)), and a
syncing demo would be a one-tap door into it for every tourist. So
**`saveGroupKey` is the only thing that may create a key row and it refuses the
demo id**, which `scripts/rules-check.mjs` holds — the one invariant here whose
quiet breakage would look like nothing at all, because the demo would simply
start working harder. `lib/db/sync.ts` writes the table too and only ever
updates a row it has just read.

The cost is paid in one place and paid out loud: no key means no invite link,
so **Copy invite link refuses** rather than disappearing
([frontend.md](frontend.md#routing)).

Scanning is the one thing that would otherwise have been a second cost, since
`/api/groups/:id/scan` authenticates a bearer against a row in D1. It is not:
the demo scans under **this phone's own scan credential**, the one a quick
split already carries ([ADR-0035](decisions/0035-a-quick-split-is-a-bill-with-no-group.md)),
so the camera works there and the demo's id still reaches the server in
nothing. `useScanAs` is the whole of that choice, and `pnpm demo` watches the
requests to hold it.

**A forgotten group is skipped**, not synced in the background forever. It
keeps its secret, but not who this phone was in it: opening the invite link
again un-forgets it and asks.

**Every attempt is written down.** A success stamps `groupKeys.lastSyncedAt`
and clears `failure`; a failure increments `failure.count` and keeps the HTTP
status. `useSyncHealth` reads it back, and `/g` says so once `count` reaches 2
— one failure is a dropped packet, two is a server that isn't there. A 403
warns immediately and differently: it means this device's secret no longer
matches the group's, which retrying can never fix and a fresh invite link can
(opening one clears the failure). `/join` reads the same flag, because that is
where a wrong secret is usually first used: a link the server refuses is a
wrong link, and the screen says so rather than leaving "this finishes by
itself once the other phone syncs" up over a sync that never will.
`navigator.onLine` answers a different question and only drives the "Offline"
banner: it reports a link, not an answering server, so it is blind to exactly
the outage that costs a trip its ledger.

## Conflicts

Two people editing the same expense while one is offline: the highest HLC wins
the **whole entry**, and **both ops stay in the log**, so history shows the
losing edit and who made it, in order, like any other revision. A device that
has caught up posts what it just pulled, so in practice both changes survive —
only a save from a snapshot older than the peer's edit loses one. Members, rates
and identities still merge per field.

`FieldChange.supersededByOpId` from `core/history.ts` marks which later op
replaced a field, and is tested — but nothing renders it (the owner finds it
visually noisy). It's there if a future screen wants it.

We never present a conflict-resolution dialog. For an expense splitter that
would be worse than being briefly wrong — the group can see the history and fix
it in one tap.

## History UI

Falls out of the log with no extra storage. **Per expense**: `ops` filtered by
`entityId`, newest first, each revision being the **difference between the fold
before the op and the fold after it** — never a reading of the patch's keys, or
a whole-entity write would read as "changed everything". **Group feed**: all ops, same renderer. Both are read
only: there is no restore-to-version, and undoing something is editing it
([ADR-0031](decisions/0031-history-reads-it-does-not-rewind-it.md)).

The sentence for a revision lives in `apps/web/lib/history-copy.ts` — it is the
app's vocabulary for the log, and it names the member a membership revision is
*about* rather than the actor, or adding three people reads as one person
joining three times. A **split** revision asks two questions in that order — who
is involved, then what each of them owes — and answers whichever changed: the
names, or a share line ("Evenly" → "Ana ×2 · Bo ×1"). Where neither moved it
says nothing at all and the next field speaks, because a spec can be rewritten
without meaning anything different — except where that rewrite is the whole of
the save, which gets the mode ("Evenly" → "By items") as a last resort
rather than nothing. The **payer** side asks the same two questions over again — who
put money in, then how much each of them did, priced in the entry's own
currency — and an income asks both of them the other way round.

A revision therefore carries the **whole entity either side of it**
(`Revision.before` / `after`), not only the fields that moved: a co-payer added
beside the largest contributor moves `payers` alone, and the name they join is
on the entity rather than in the change. The same reading is what makes the
noun exact — an income is called one on every later edit of it, not only on the
revision that crossed — and what prices each figure in its own currency.

A revision is regularly **several** fields, since an entry is saved whole: a
merge can revert somebody's amount in the same op that changes the description.
So the sentences above are for a revision that moved exactly one field. Where
more than one moved, **no field outranks another**: the line says only that the
entry was edited, and each field that moved gets a labelled was/now line under
it. Ranking them would caption a revision "changed who's involved" and hide
that the amount had gone back — the one thing an audit trail exists to answer.

## Gotchas

- **A second path to the server is a second place to forget the seal.** Anything
  that ships an op has to go through `pushPullGroup`, or the claim on `/about`
  quietly stops being true.
- **Never garbage-collect ops.** They are the history feature. If the log ever
  got genuinely large the answer is snapshotting, and that's a new ADR.
- `createdAt` is display-only. Sort by it and conflicts start resolving
  differently on different phones.
- **A screen waiting on sync must watch the DB, not check once.** A one-shot
  check after `syncGroup()` dead-ends a new device whose first attempt failed
  while `StartSync`'s background loop retries successfully. `/join` watches
  `groups` live and moves on the moment the group lands, from any attempt. The
  secret is saved up front either way.
- **D1 binds a hundred parameters to a statement, not a thousand.** Nothing may
  build a clause out of an array that came in over the wire: `acceptOps` cuts
  the queue up before it asks which ops it already has. Otherwise a phone with a
  fortnight of expenses pushes, fails, and retries the identical oversized
  batch forever.
- **A seq number must never exist before its row does.** `acceptOps` reserves
  and inserts in one `db.batch`, which D1 runs as a transaction, because a phone
  that pulls in between is told `latestSeq` covers rows it cannot read yet —
  and it writes that number down as its cursor. The ops stay on the server and
  are lost to that phone for good.
