# Data model

*For: anyone touching entities, money, splits, or the D1 schema.*

## Money

**Integer minor units. Always.** A money field is named `*_minor`/`*Minor` and
is an integer number of cents. No float anywhere represents money. Formatting
happens in the view layer and nowhere else. Currency codes are ISO 4217;
exponents vary (JPY 0, TND 3) and `core/money.ts` owns that table — never assume
2.

**A rate belongs to the entry.** A group has a base currency; a foreign entry
carries its own `rateToBase`, fetched for its day when it was written, and is
worth its amount at that rate — nothing written later moves it
([ADR-0005](decisions/0005-money-and-currency.md)). A `Rate` is an exact
decimal string (`isValidRate`), never a float, stored to 12 significant digits
and shown to 6 — enough that typing it as its inverse round-trips.

## The three kinds of entry

What a person adds to a group is an **expense**, an **income** or a **transfer**
([ADR-0010](decisions/0010-what-an-entry-is.md)). Only two entities carry
them:

| Entry | Entity | How it differs |
|---|---|---|
| Expense | `Expense` | The default. `kind` absent. |
| Income | `Expense`, `kind: 'income'` | Same positive amount, payers and split; `computeBalances` applies the sign. |
| Transfer | `Settlement` | Two people, no split. Never touches what the trip cost. |

The wire, the types and the D1 `entity` column say `settlement`; **every word a
person reads says *transfer*** — the vocabulary lives once, in
`apps/web/lib/entry-kind.ts`. "Reimbursement" is not a *kind*: paying somebody
back is one reason to make a transfer, not a different kind of one — it is only
the note on a transfer settle-up's Record writes (`copy.form.reimbursement`).

## Entities

Materialised by folding ops into IndexedDB tables. Authoritative nowhere on the
server.

```ts
Group      { id, name, baseCurrency, createdAt, archivedAt?, importedFrom? }
Member     { id, groupId, name, colorSeed, deletedAt? }
Settlement { id, groupId, fromMember, toMember, amountMinor, currency,
             rateToBase, baseAmountMinor, rateSource?, occurredAt, createdAt?, note?, deletedAt? }
Attachment { id, groupId, expenseId, r2Key, mime, bytes, width, height,
             uploadState: 'local'|'uploading'|'uploaded', createdAt }
Identity   { id /* the device's HLC node id */, groupId, memberId, claimedAt,
             push? /* { endpoint, p256dh, auth, scope? } | null */ }
ExchangeRate { id /* the ISO 4217 code — the currency IS the entity */, groupId,
             rate /* 1 unit of `id` = `rate` units of the group's base */,
             source: 'fetched'|'typed', asOf, deletedAt? }
             // the retired registry: folded, never written (ADR-0005)

Expense {
  id, groupId, description, categoryId, occurredAt,
  kind?,              // 'income' on an income; ABSENT on an expense, always,
                      // so the common case never carries the field
  createdAt?,         // set once at creation; list-order tiebreak for
                      // same-day expenses, since occurredAt is user-editable
                      // (see "A day without a time" below)
  amountMinor,        // in `currency`
  currency,           // ISO 4217, may differ from group base
  rateToBase,         // decimal string, "1" when same currency — the entry's
                      // own, frozen at save (ADR-0005)
  baseAmountMinor,    // amountMinor × rateToBase, rounded once; stored, and
                      // re-derived on read (`atCurrentRates`)
  rateSource?,        // 'fetched'|'typed'|'copied'|'imported'|'group'; absent in the base
                      // currency, and on an entry from before the move
  paidBy,             // memberId — the payer, or the largest co-sponsor
  payers?,            // memberId -> minor units in THIS expense's currency,
                      // summing to amountMinor. Absent = one payer (ADR-0010)
  split: { mode: 'equal' | 'exact' | 'shares' | 'receipt', ... },
  attachmentIds?,     // absent when there are none, which is every
                      // expense today: nothing appends an attachment op yet
  receiptItems?, receiptTip?, receiptInvolved?, receiptAssignments?,
                      // the parsed bill behind a `receipt` split, kept so the
                      // who-had-what grid can reopen (ADR-0016)
  receiptText?,       // a typed bill's text, from builds that read one; written
                      // by nothing now, and still read by history
  receiptEnglish?,    // true: the bill is read in English, not as printed —
                      // the grid's translate toggle (ADR-0016)
  deletedAt?
}
```

Split payloads: `equal { members[] }`, `exact { amounts, rest? }`, `shares { weights }`,
`receipt { weights }`. **An `exact` zero is
nobody**: none is ever written, and `splitParticipants` reads one as out.
**`rest` is who is in with no figure typed**: they share what the typed figures
leave, evenly and seeded as Evenly is (`exactFigures`), worked out again at
every read. Their figures are still written into `amounts` (`settleRest`, on
save), so a phone that predates `rest` reads a whole split that adds up; the
key is absent when nobody floats, so older splits serialise unchanged.
`convertSplitMode` carries who is in and no numbers, so every mode opens "as
amounts" as everyone in `rest`, nothing typed. A mode this build doesn't know
(the retired `percent`, written for a day before the September wipe) names nobody, so it reads as a split
that can't be resolved, not a crash: the screen heads it by its own name and
the form opens it on Evenly. **`receipt` is the only mode nobody types** — a scanned bill writes it and `convertSplitMode`
never converts into it ([ADR-0016](decisions/0016-receipts.md)). A `shares`
split saved beside a kept bill is written with `splitTab: "shares"`, the one
field an op carries that no state keeps: the fold reads it and drops it
(`upgradeReceiptSplit`). Builds between `receipt` becoming a mode and that flag
wrote such parts unflagged, so an unflagged one stamped after
`RECEIPT_MODE_SINCE` is parts, and one before it a grid.
What a person calls each mode is `copy.split.mode` in `apps/web/lib/copy.ts`
and nowhere else ([ADR-0033](decisions/0033-every-word-in-one-file.md)).

- A member is a person, not an account, and is tombstoned rather than
  hard-deleted or the fold references nothing.
- **Nobody leaves a group; they are removed.** `removeMember` is the only
  thing that tombstones one, People never puts a trash button on your own row,
  and there is no un-claim — so the actor on a member delete is never its
  subject, and history has no sentence for it.
- Forgetting a group is local — no tombstone, and no op but a subscribed
  phone's `push: null` ([notifications.md](notifications.md)) — so it takes the
  group off *this phone* without touching membership or the group itself, and
  **needs no claim**: a group this phone never said who it was in is the one it
  most wants off the list, and there is nothing an unclaimed phone lacks to do
  it. **It erases, not hides** — ops, folded tables, secret and claim — as soon
  as nothing of the group is left to push; an offline edit or that `push: null`
  keeps it, hidden, until the sync that sends them
  ([sync.md](sync.md#a-forgotten-group-is-erased)). Keeping more bought nothing:
  no screen lists forgotten groups, and the invite link that would bring one
  back re-downloads it anyway. Only the bare id stays, in `device.leftGroups`.
  Opening the link again is a join: it asks who you are, and answering writes
  an identity `update` over the claim the log still holds.
- The UI (not `removeMember` itself) refuses to remove someone else while
  `memberInvolved` (payers.ts) still finds them on a live entry of **either**
  kind — a payer or split participant on an expense, or a side of a transfer.
  Past involvement they've since been edited out of doesn't count. Ask that
  function rather than one of its halves: asking about expenses alone leaves a
  balance with nothing on the other side of it. It also refuses the **last**
  member: a group with nobody in it has no payer to seed an entry with.
- **A removal the group goes on contradicting is undone.** That refusal needs
  both facts on one phone, so two offline beat it — one removes Bruno, the
  other writes a transfer to him — and the merge lands a tombstone on live
  money. `liveEntriesNameLiveMembers` (core/invariants.ts) names that state and
  `healGroup` (`commands/groups.ts`) folds it away: an entry is
  money somebody typed and a removal only the claim that nobody named them, so
  the tombstone is the half that gives way. It is lifted with an ordinary
  `deletedAt: null`, and history says the entry is why rather than naming the phone that noticed. The
  sync engine runs it, right after the merge that could have caused it — a
  local write is refused before it lands, so nothing else can. Being on a line of a
  receipt counts as being involved, even where it nets to nothing; being
  only ticked as there does not. Without this a departed member's balance has no way out: the
  transfer form refuses the name the settle-up row opens with.
- **A member's id is their name** — `memberIdFor(groupId, name)`, so two phones
  adding "Ana" offline write one member rather than two people nothing on
  screen tells apart, and re-adding somebody returns the person with their
  balance ([ADR-0034](decisions/0034-a-member-is-their-name.md)). Members
  written before that carry `newId()` and keep the gap.
- **A phone whose member was removed puts them back**, whatever the reason —
  `restoreClaimDrafts`, signed as the person being restored. Not a registered
  invariant: its premise is which member *this* phone is, and no `GroupState`
  holds that. Forgetting the group is the exit
  ([invariants.md](invariants.md#why-each-is-held-the-way-it-is)).
- A removed member who still carries a balance is **shown** on the balances
  tab, marked as departed. `computeBalances` keeps them while an entry names
  them, so the set sums to zero on screen. The row is a moment rather than a resting state, since
  the removal is undone — but only a phone holding both halves of the race can
  undo it, and every other one still has to draw a balance that adds up.
- **`baseAmountMinor` is re-derived on read**: `atCurrentRates`
  (`core/rates.ts`) values every entry at its own rate in `derive`, so a merge
  pairing one phone's amount with another's figure still reads consistently. An
  entry with no `rateSource` — written while rates were the group's — is read at
  the old registry's rate until `entriesCarryTheirOwnRate` writes it on. That
  can't live in the fold: `materialise()` folds one entity's ops, so a rate op
  and an expense never meet there ([ADR-0005](decisions/0005-money-and-currency.md)).
- **A group's id is 12 base36 characters**, not a UUID: it rides in every
  invite link, where its length is something people paste
  ([ADR-0003](decisions/0003-link-only-access.md)). Groups made before that
  keep their UUID, so an id's shape is never what code reads.
- **An exchange rate is identified by its currency code**, the one entity whose
  id is a word rather than `newId()`. So its Dexie key is compound
  (`[groupId+id]`) — two trips both spending in MAD are two rows — and anything
  re-folding one entity has to scope by group as well as by id.
- A settlement (a **transfer**) is structurally separate from an expense so it
  never pollutes "how much did the trip cost". So is income, which is counted in
  `totalIncomeMinor` and never netted into `totalSpendMinor`.
- `Attachment` is a seam, not a feature: nothing appends one, there is no
  bucket, and `attachmentIds` is absent on every expense
  ([product.md](product.md#deliberately-not-in-the-mvp)).
- **Identity is one row per device**, keyed by the node id ending every HLC that
  device stamped. Claims are ops
  ([ADR-0003](decisions/0003-link-only-access.md)); the device's own
  pointer stays in `device.meByGroup`, unsynced — changing it appends the op.
  `push` is the device's Web Push subscription, read only by the phone
  sending a notification ([notifications.md](notifications.md)); history drops
  a revision that moved nothing else.

### A day without a time

An entry's clock is never typed — the form has a date and no time — so
`occurredAt` only ever holds the reading taken when the entry was **recorded**.
Left on that day it means something. On any other day it is a leftover, and
**`dateOnly` says so**: the time is not information. The flag is the fact, and
nothing reads a meaning back out of the number, because nothing can tell
midnight-the-moment from midnight-the-empty-field.

Two writers set it, and neither is about receipts. The date field marks an
entry date-only when the chosen day is not the one it is being recorded on
(`retimed`, `lib/draft.ts`) — coming back to that day restores the reading
rather than the 00:00 a backdated stamp was parked at. And `normalizeScan`
marks a receipt printed on any day but today, whose stamp is then local
midnight of the printed day. A backdated receipt is the common case, not a case
of its own. Transfers carry the field for the same reason expenses do.

Two rules follow, both in `apps/web/lib/format.ts`: `whenLabel` prints the day
alone rather than a `00:00` nobody read off a receipt, and `byWhen` puts such
an entry at the **head** of its day rather than the foot — the time is missing,
not early. Several of them in one day order by `createdAt`, newest addition
first: nothing on them can say what happened when, and when they were added is
the only fact there is. The merge of the two tables into the list a person
reads is `ledgerRows` (`apps/web/lib/ledger.ts`), which asks the entry itself
rather than copying what places it in time.

It is written like every other uncommon field: absent on an ordinary entry, and
so absent on every entry written before it existed. Those keep the time they
have always shown — there is nothing on them to say otherwise, and guessing
from the stamp is the thing this field exists to stop.

## Splits — the only tricky arithmetic

Every mode resolves to `Record<memberId, minorAmount>` summing **exactly** to
`baseAmountMinor`. Not approximately. `core/split.ts`:

ideal share as an exact rational → floor to minor units → distribute the
remainder by **largest fractional part**, ties broken by a hash of
`${tiebreakSeed}:${memberId}` (callers pass the expense id — the form included,
which quotes its rows under the id it will write, so the leftover cent lands on
a different person each time while staying identical across devices *and* across
the save) →
return the map plus `remainderAbsorbedBy`.

**An `exact` split is typed in the entry's own currency**, as its payers are:
the figures on the bill, needing no rate. They sum to `amountMinor`, and
`resolveEntrySplit` apportions `baseAmountMinor` by them — ask it, never
`resolveSplit`, of a stored entry. Entries written before this hold base
amounts summing to `baseAmountMinor`; the same call reads them unchanged and
the form converts them on opening (`ownCurrencySplit`). Every tab reads out in
the entry's own currency too, so a WUP bill is never cut into CRD shares; the
entry screen puts the base figure first and the own one beside it, as it does
for payers.

**`remainderAbsorbedBy` is diagnostic, not UI.** Determinism outranks fairness:
two phones folding the same ops must produce byte-identical splits or balances
diverge, and the seeded draw buys fairness inside that constraint.

**A split is written canonically** (`canonicalSplit`): members sorted and
deduplicated, weight maps keyed in sorted order. The log is diffed and read as
JSON, so two specs meaning the same thing have to serialise the same — toggling
a member out and straight back in reorders the array, and must not append an
op saying "changed who's involved" with identical names on both lines.

## Co-sponsored expenses

`payers` is the payer-side mirror of `split`, edited on `/g/payers`
([ADR-0010](decisions/0010-what-an-entry-is.md)). Amounts are in the
**entry's own currency** and sum to `amountMinor`; `resolvePayers()` apportions
the stored `baseAmountMinor` at read time so the payer side sums to it exactly;
`paidBy` is kept in step as the largest contributor (one live contributor is
stored as `null`); a payer need not be a participant. On an income the same map
names who *received* it.

## Balances and settle-up

Both **derived on read, never stored.** In base minor units over every entry,
`balance(member) = Σ(paid) − Σ(share) − Σ(received) + Σ(income share)`, plus
transfers out and minus transfers in; the set always sums to zero (assert it in
dev). The income terms are the expense terms with the sign flipped, applied in
`core/balance.ts` and nowhere else — and a save moves the last sum by the
entries it changed rather than adding up again (`retallyBalances`,
[live-reads.md](live-reads.md#a-save-moves-a-few-entries)). Settle-up is **the fewest transfers there are**, for
every group shape the app realistically sees. Cut the members into as many
zero-sum pieces as possible and each piece takes exactly `size − 1` payments,
so `n − pieces` is the minimum; finding the cut is the NP-hard part, and
`core/settle.ts` explains the three moves that make it affordable — pair off
exact opposites first, search over *amounts* rather than people so members
owing the same are one state, and stop extending a candidate piece the moment
its total hits zero. An evenly split group of 100 settles exactly in under a
millisecond. What defeats all three is ~18+ members with no two balances alike,
where the search spends a fixed budget, peels off what zero-sum triples and
quadruples it can, and settles the rest as one piece — still `≤ n−1`, no longer
provably fewest, which is why the UI says "simplest way to settle" and never
"optimal". Which of the equally-short answers you get is the second question:
smallest debtor first, into the smallest creditor who can absorb the whole
debt, so owing a little means one transfer and only a debt too big for any
single creditor is split.


## D1 schema

The server stores **sealed** ops and nothing else it could read
([ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)). There is no
`expenses` table on the server, which is the whole point of
[ADR-0002](decisions/0002-append-only-op-log.md) — and no `entity`, `patch`
or `actor` column either, because those would say what an op meant.

**Changing it keeps what is in it.** The data is never reset again, so a change
here is a new numbered migration, never an edit to an applied one —
[hosting.md](hosting.md#a-schema-change-from-here-on).

```sql
CREATE TABLE groups (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL,    -- sha256 of the derived token
  created_at INTEGER NOT NULL, last_op_seq INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER);                              -- 0003: the tombstone, see sync.md

CREATE TABLE ops (
  seq INTEGER NOT NULL,          -- per-group, assigned by the server
  id TEXT PRIMARY KEY,           -- client UUID = idempotency key
  group_id TEXT NOT NULL REFERENCES groups(id),
  sealed TEXT NOT NULL,          -- base64: version byte, IV, AES-GCM ciphertext
  received_at INTEGER NOT NULL); -- our clock; the phone's createdAt is sealed
CREATE UNIQUE INDEX ops_group_seq ON ops(group_id, seq);
-- `ops` is read-only since 0004: every push since is one row here (sync.md)

CREATE TABLE op_batches (            -- 0004: a push's ops in one row
  group_id TEXT NOT NULL,
  last_seq INTEGER NOT NULL,         -- holds seqs last_seq - n + 1 .. last_seq
  ids TEXT NOT NULL,                 -- JSON array of the n op ids, in seq order
  sealed TEXT NOT NULL,              -- JSON array of their seals, same order
  received_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, last_seq)) WITHOUT ROWID;

CREATE TABLE splits (                -- 0005: a quick split sent as a link (ADR-0035)
  id TEXT PRIMARY KEY,               -- derived from the link secret, never sent
  token_hash TEXT NOT NULL,          -- sha256 of the derived token, as for a group
  sealed TEXT NOT NULL,              -- base64: version byte, IV, AES-GCM ciphertext
  created_at INTEGER NOT NULL) WITHOUT ROWID;

CREATE TABLE scan_hits (             -- 0002: the scan budget, pruned at 24h
  at INTEGER NOT NULL,               -- ms, our clock
  caller TEXT NOT NULL,              -- the :id a scan was billed to
  client TEXT NOT NULL);             -- HMAC(ip, SCAN_IP_SALT) — never the address
CREATE INDEX scan_hits_at ON scan_hits(at);
```

`scan_hits` is the one table here that is not a ledger: rows live a day,
because every window it answers is an hour or a day, and nothing in it says
what was photographed — only that somebody spent a call
([scan-worker.md](scan-worker.md#what-the-scan-costs)).

There is no `attachments` table: attachments are not built
([product.md](product.md#deliberately-not-in-the-mvp)), and an encrypted one
would want its own columns.

## IndexedDB (Dexie)

| Store | Key | Notes |
|---|---|---|
| `ops` | `id` | indexes on `groupId`, `entityId`, `hlc`, `pending`, `[groupId+hlc]`, `[groupId+pending]` |
| `groups`, `members`, `expenses`, `settlements`, `attachments` | `id` | materialised, rebuildable from `ops`; each row stamped with `rev` ([live-reads.md](live-reads.md#a-save-moves-a-few-entries)) |
| `rates` | `[groupId+id]` | the retired exchange registry, `id` being the currency code |
| `identities` | `[groupId+id]` | one row per device per group, `id` being the device's node id |
| `device` | key | who "you" are, theme, HLC state, whether the install nudge is folded, and the ids of groups known to be deleted |
| `groupKeys` | `groupId` | the invite secret and sync cursor. Never an op, and never derived-from on disk — [ADR-0003](decisions/0003-link-only-access.md) |
| `notices` | `id` | push notifications waiting for their ops to land, device-local like `groupKeys` — [notifications.md](notifications.md#how-it-works) |

**v8 declares all of it but `notices`**, which v9 adds with no upgrade;
earlier versions are collapsed away. The v8 upgrade does one thing — re-arm every op as pending and reset each sync
cursor — so a phone's log refills a server copy that was wiped for sealing
([ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)). v10 refolds
every cached `receipt` row from its ops, for a fold that learned to read some
of them as parts (`RECEIPT_MODE_SINCE`) — a cache is refolded only when a pull
brings ops. v11 adds `[groupId+pending]`, so a group's waiting ops are counted
and pushed by the index rather than by walking its log — an import leaves
thousands.

The materialised stores are a **cache**: if a migration gets confusing, drop
them and re-fold from `ops`. Never migrate materialised data by hand — which is
why re-keying a table costs a drop and a `rebuild()`, not a data migration.

## Gotchas

- `Intl.NumberFormat` will happily render a float. Format from minor units via
  `core/money.ts`; don't reach for `toFixed`.
- **A device's identity id is its HLC node id** — one string per install, the
  same in every group it joins. So `identities` is keyed by `[groupId+id]`, like
  `rates`: keyed by the node id alone, a phone in two groups would have one row,
  and re-folding either group would delete the other's claim.
  Anything re-folding one entity has to scope by group as well as by id.
