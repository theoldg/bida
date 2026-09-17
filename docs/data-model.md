# Data model

*For: anyone touching entities, money, splits, or the D1 schema.*

## Money

**Integer minor units. Always.** A money field is named `*_minor`/`*Minor` and
is an integer number of cents. No float anywhere represents money. Formatting
happens in the view layer and nowhere else. Currency codes are ISO 4217;
exponents vary (JPY 0, TND 3) and `core/money.ts` owns that table — never assume
2.

**A rate belongs to the group, not to the entry.** A group has a base currency
and an `ExchangeRate` row per other currency it spends in; what a foreign entry
is *worth* is read from that registry every time, so correcting a rate moves
every entry already written in that currency
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
what a new transfer's note says by default (`blankDraft`), and typing over it,
or switching to another kind, takes the word away.

## Entities

Materialised by folding ops into IndexedDB tables. Authoritative nowhere on the
server.

```ts
Group      { id, name, baseCurrency, createdAt, archivedAt? }
Member     { id, groupId, name, colorSeed, deletedAt? }
Settlement { id, groupId, fromMember, toMember, amountMinor, currency,
             rateToBase, baseAmountMinor, occurredAt, createdAt?, note?, deletedAt? }
Attachment { id, groupId, expenseId, r2Key, mime, bytes, width, height,
             uploadState: 'local'|'uploading'|'uploaded', createdAt }
Identity   { id /* the device's HLC node id */, groupId, memberId, claimedAt }
ExchangeRate { id /* the ISO 4217 code — the currency IS the entity */, groupId,
             rate /* 1 unit of `id` = `rate` units of the group's base */,
             source: 'fetched'|'typed', asOf, deletedAt? }

Expense {
  id, groupId, description, categoryId, occurredAt,
  kind?,              // 'income' on an income; ABSENT on an expense, always,
                      // so the common case never carries the field
  createdAt?,         // set once at creation; list-order tiebreak for
                      // same-day expenses, since occurredAt is user-editable
  amountMinor,        // in `currency`
  currency,           // ISO 4217, may differ from group base
  rateToBase,         // decimal string, "1" when same currency — what was
                      // believed at save; the registry overrides it on read
  baseAmountMinor,    // amountMinor × rateToBase, rounded once, STORED
  paidBy,             // memberId — the payer, or the largest co-sponsor
  payers?,            // memberId -> minor units in THIS expense's currency,
                      // summing to amountMinor. Absent = one payer (ADR-0010)
  split: { mode: 'equal' | 'exact' | 'shares' | 'percent' | 'receipt', ... },
  attachmentIds?,     // absent when there are none, which is every
                      // expense today: nothing appends an attachment op yet
  receiptItems?, receiptTip?, receiptInvolved?, receiptAssignments?,
                      // the parsed bill behind a `receipt` split, kept so the
                      // who-had-what grid can reopen (ADR-0016)
  deletedAt?
}
```

Split payloads: `equal { members[] }`, `exact { amounts }`, `shares { weights }`,
`percent { bps }` (basis points), `receipt { weights }`. **`percent` is legacy
and read-only** ([ADR-0010](decisions/0010-what-an-entry-is.md)); **`receipt` is
the only mode nobody types** — a scanned bill writes it and `convertSplitMode`
never converts into it ([ADR-0016](decisions/0016-receipts.md)).
What a person calls each mode is `copy.split.mode` in `apps/web/lib/copy.ts`
and nowhere else ([ADR-0033](decisions/0033-every-word-in-one-file.md)).

- A member is a person, not an account, and is tombstoned rather than
  hard-deleted or the fold references nothing.
- **Nobody leaves a group; they are removed.** `removeMember` is the only
  thing that tombstones one, People never puts a trash button on your own row,
  and there is no un-claim — so the actor on a member delete is never its
  subject, and history has no sentence for it.
- Forgetting a group (`device.leftGroups`) is purely local — no op, no
  tombstone, nobody else sees it — so it drops off *your* list without
  touching membership or the group itself, and **needs no claim**: a group this
  phone never said who it was in is the one it most wants off the list, and
  there is nothing an unclaimed phone lacks to do it. Groups are never deleted. It also
  drops this phone's `meByGroup` entry, so opening the invite link again clears
  the hide and asks who you are; answering writes an identity `update` over
  the claim the log still holds.
- The UI (not `removeMember` itself) refuses to remove someone else while
  `memberInvolved` (payers.ts) still finds them on a live entry of **either**
  kind — a payer or split participant on an expense, or a side of a transfer.
  Past involvement they've since been edited out of doesn't count. Ask that
  function rather than one of its halves: asking about expenses alone left
  groups carrying a balance with nothing on the other side of it. It also
  refuses the **last** member: a group with nobody in it has no payer to seed
  an entry with, and the form gave up on that silently.
- **A removal the group goes on contradicting is undone.** That refusal needs
  both facts on one phone, so two offline beat it — one removes Bruno, the
  other writes a transfer to him — and the merge lands a tombstone on live
  money. `liveEntriesNameLiveMembers` (core/invariants.ts) names that state and
  `healGroup` (`commands/groups.ts`) folds it away: an entry is
  money somebody typed and a removal only the claim that nobody named them, so
  the tombstone is the half that gives way. It is lifted with an ordinary
  `deletedAt: null` — as re-setting a cleared rate lifts that row's — and
  history says the entry is why rather than naming the phone that noticed. The
  sync engine runs it, right after the merge that could have caused it — a
  local write is refused before it lands, so nothing else can. Being named on a receipt's "who was there" counts as
  being involved, even where it costs nothing. Until this ran, a departed
  member's balance had no way
  out: the balances tab offered the settle-up row that would square them off,
  and the transfer form refused the name that row opened with.
- **A rate comes out on the same terms**, and comes back on them too. Clearing
  one used to be allowed, and every entry written in that currency silently
  fell back to the rate it was saved at — a different number on each row, and
  no screen mentioning it. `/g/rates` blocks removal while any entry is written
  in that currency, listing them, exactly as People does; and when two phones
  beat that refusal, `liveEntriesHaveLiveRates` lifts the tombstone the way the
  member healer does. A currency the group has *never* priced is a different
  state and is left alone — there is no number to put back.
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
  tab, marked as departed. `computeBalances` `touch()`es them so the set sums
  to zero; hiding them is what made the bars stop summing to zero on screen.
  The row is a moment rather than a resting state now that the removal is
  undone — but only a phone holding both halves of the race can undo it, and
  every other one still has to draw a balance that adds up.
- `baseAmountMinor` and `rateToBase` are **stored**, but they are not what an
  entry is worth: `atCurrentRates` (`core/rates.ts`) reprices every entry at the
  registry in `stateOf()`, so one pass values the whole app and no call site can
  forget. It cannot live in the fold — `materialise()` folds one entity's ops,
  so a rate op and an expense never meet there. Stored values are the honest record of what was believed at save, and
  the fallback for a currency the registry has no row for — every foreign entry
  written before the registry existed, and any rate a group removes
  ([ADR-0005](decisions/0005-money-and-currency.md)).
- **A group's id is 12 base36 characters**, not a UUID: it rides in every
  invite link, where its length is something people paste
  ([ADR-0003](decisions/0003-link-only-access.md)). Groups made before that
  keep their UUID, so an id's shape is never what code reads.
- **An exchange rate is identified by its currency code**, the one entity whose
  id a person chooses rather than `newId()`. So its Dexie key is compound
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

**`remainderAbsorbedBy` is diagnostic, not UI.** Determinism outranks fairness:
two phones folding the same ops must produce byte-identical splits or balances
diverge, and the seeded draw buys fairness inside that constraint.

**A split is written canonically** (`canonicalSplit`): members sorted and
deduplicated, weight maps keyed in sorted order. The log is diffed and read as
JSON, so two specs meaning the same thing have to serialise the same — toggling
a member out and straight back in reorders the array, and that used to append an
op saying "changed who's involved" with the identical names on both lines.

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
`core/balance.ts` and nowhere else. Settle-up is **the fewest transfers there are**, for
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

## The group as a spreadsheet

`core/export.ts` writes **Splitwise's export shape** and no other:
`Date,Description,Category,Cost,Currency` then one column per member,
`YYYY-MM-DD` dates, plain decimals, CRLF, no BOM. Tricount has no import of
its own format — it has "import from Splitwise" — so these columns are what
get a group into Tricount, Splitwise, Sesterce, Spliit and a spreadsheet, and
Tricount's own `Paid by X`/`Paid for X` shape would reach nothing this does
not. `Payment`, `General` and `Total balance` are spelled exactly so because
an importer matches them literally; they are protocol tokens, not copy, which
is why they are in core and not `copy.ts` ([ADR-0033](decisions/0033-every-word-in-one-file.md)).

**A member's cell is `paid − owed` for that row.** Every row therefore nets to
zero and the column totals are the balances — the `Total balance` foot is
`computeBalances().byMember`, to the cent, because the rows come from
`resolvePayers` and `resolveSplit` under the same tiebreak seeds. It is one
arithmetic with two readouts, not two opinions.

Three facts have nowhere to go in the shape, and each is resolved the same
way — by saying what is true rather than inventing a column:

- **Currency.** One `Currency` per row and one set of member columns, so
  there is no way to say a row is in MAD while the balance below it is in
  euros. The caller hands over a state already repriced at the registry and
  the column is constant — which is also the only way the foot agrees with
  the Balances tab ([ADR-0005](decisions/0005-money-and-currency.md)).
- **Income.** No such concept there, so `Cost` is negative and the member
  cells carry the flipped sign `computeBalances` applies. An importer that
  refuses a negative refuses the row, which beats silently booking a cost.
- **An entry nothing can apportion.** Kept, with every member cell zero.
  Dropping it would lose money somebody typed; apportioning the payers alone
  would break both the row's zero and the foot. It is already named on the
  balances tab, out of the same `problems`.

A **removed** member still named on a live entry gets a column, under their
plain name: without it nothing sums to zero, and "Bruno (removed)" would
import as a fourth person.

## D1 schema

The server stores **sealed** ops and nothing else it could read
([ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)). There is no
`expenses` table on the server, which is the whole point of
[ADR-0002](decisions/0002-append-only-op-log.md) — and now no `entity`, `patch`
or `actor` column either, because those said what an op meant.

**Changing it keeps what is in it.** The 2026-09-12 reset was the last one the
owner authorises, so a change here is a new numbered migration beside
`0001_init.sql` rather than an edit to it —
[hosting.md](hosting.md#a-schema-change-from-here-on).

```sql
CREATE TABLE groups (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL,    -- sha256 of the derived token
  created_at INTEGER NOT NULL, last_op_seq INTEGER NOT NULL DEFAULT 0);

CREATE TABLE ops (
  seq INTEGER NOT NULL,          -- per-group, assigned by the server
  id TEXT PRIMARY KEY,           -- client UUID = idempotency key
  group_id TEXT NOT NULL REFERENCES groups(id),
  sealed TEXT NOT NULL,          -- base64: version byte, IV, AES-GCM ciphertext
  received_at INTEGER NOT NULL); -- our clock; the phone's createdAt is sealed
CREATE UNIQUE INDEX ops_group_seq ON ops(group_id, seq);

CREATE TABLE scan_hits (             -- 0002: the scan budget, pruned at 24h
  at INTEGER NOT NULL,               -- ms, our clock
  caller TEXT NOT NULL,              -- the :id a scan was billed to
  client TEXT NOT NULL);             -- HMAC(ip, SCAN_IP_SALT) — never the address
CREATE INDEX scan_hits_at ON scan_hits(at);
```

`scan_hits` is the one table here that is not a ledger: rows live a day,
because every window it answers is an hour or a day, and nothing in it says
what was photographed — only that somebody spent a call
([receipt-scanning.md](receipt-scanning.md#what-the-scan-costs)).

There is no `attachments` table: it indexed R2 objects for a feature that was
cut ([product.md](product.md#deliberately-not-in-the-mvp)), and an encrypted one
would want different columns anyway.

## IndexedDB (Dexie), schema v8

| Store | Key | Notes |
|---|---|---|
| `ops` | `id` | indexes on `groupId`, `entityId`, `hlc`, `pending`, `[groupId+hlc]` |
| `groups`, `members`, `expenses`, `settlements`, `attachments` | `id` | materialised, rebuildable from `ops` |
| `rates` | `[groupId+id]` | the group's exchange registry, `id` being the currency code |
| `identities` | `[groupId+id]` | one row per device per group, `id` being the device's node id |
| `device` | key | who "you" are, theme, HLC state, whether the install nudge is folded |
| `groupKeys` | `groupId` | the invite secret and sync cursor. Never an op, and never derived-from on disk — [ADR-0003](decisions/0003-link-only-access.md) |

**One version declares all of it.** The chain of seven that got here has been
collapsed: every phone had run them, and what a schema was on the way here is
the git log's business. The v8 upgrade does one thing — re-arm every op as
pending and reset each sync cursor — because the server's copy was wiped when
sealing landed and the phone's log is what refills it
([ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)).

The materialised stores are a **cache**: if a migration gets confusing, drop
them and re-fold from `ops`. Never migrate materialised data by hand — which is
why re-keying a table costs a drop and a `rebuild()`, not a data migration.

## Gotchas

- `Intl.NumberFormat` will happily render a float. Format from minor units via
  `core/money.ts`; don't reach for `toFixed`.
- **A device's identity id is its HLC node id** — one string per install, the
  same in every group it joins. So `identities` is keyed by `[groupId+id]`, like
  `rates`: keyed by the node id alone, as it once was, a phone in two
  groups had one row, and re-folding either group deleted the other's claim.
  Anything re-folding one entity has to scope by group as well as by id.
