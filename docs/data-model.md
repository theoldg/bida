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
`apps/web/lib/entry-kind.ts`. "Reimbursement" is not a thing: paying somebody
back is one reason to make a transfer, not a different kind of one.

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
  split: { mode: 'equal' | 'exact' | 'shares' | 'percent', ... },
  attachmentIds?,     // absent when there are none, which is every
                      // expense today: nothing appends an attachment op yet
  receiptItems?, receiptTip?, receiptInvolved?, receiptAssignments?,
                      // the parsed bill behind `split`, kept so the
                      // who-had-what grid can reopen (ADR-0016)
  splitTab?,          // 'equal'|'shares'|'exact'|'receipt' — which split
                      // editor tab was showing, so it survives save (ADR-0016)
  deletedAt?
}
```

Split payloads: `equal { members[] }`, `exact { amounts }`, `shares { weights }`,
`percent { bps }` (basis points). **`percent` is legacy and read-only**
([ADR-0010](decisions/0010-what-an-entry-is.md)).
What a person calls each mode is `SPLIT_MODE_LABEL` in `apps/web/lib/format.ts`
and nowhere else.

- A member is a person, not an account, and is tombstoned rather than
  hard-deleted or the fold references nothing.
- **Nobody leaves a group; they are removed.** `removeMember` is the only
  thing that tombstones one, People never puts a trash button on your own row,
  and there is no un-claim — so the actor on a member delete is never its
  subject, and history has no sentence for it.
- Forgetting a group (`device.leftGroups`) is purely local — no op, no
  tombstone, nobody else sees it — so it drops off *your* list without
  touching membership or the group itself. Groups are never deleted. Opening
  the invite link again clears the hide.
- The UI (not `removeMember` itself) refuses to remove someone else while
  `memberInvolved` (payers.ts) still finds them on a live entry of **either**
  kind — a payer or split participant on an expense, or a side of a transfer.
  Past involvement they've since been edited out of doesn't count. Ask that
  function rather than one of its halves: asking about expenses alone left
  groups carrying a balance with nothing on the other side of it. It also
  refuses the **last** member: a group with nobody in it has no payer to seed
  an entry with, and the form gave up on that silently.
- **A rate comes out on the same terms**, and the UI is again where that is
  said. Clearing one used to be allowed, and every entry written in that
  currency silently fell back to the rate it was saved at — a different number
  on each row, and no screen mentioning it. `/g/rates` now blocks removal while
  any entry is written in that currency, listing them, exactly as People does.
- A removed member who still carries a balance is **shown** on the balances
  tab, marked as departed. `computeBalances` `touch()`es them so the set sums
  to zero; hiding them is what made the bars stop summing to zero on screen.
- `baseAmountMinor` and `rateToBase` are **stored**, but they are not what an
  entry is worth: `atCurrentRates` (`core/rates.ts`) reprices every entry at the
  registry in `stateOf()`, so one pass values the whole app and no call site can
  forget. It cannot live in the fold — `materialise()` folds one entity's ops,
  so a rate op and an expense never meet there. Stored values are the honest record of what was believed at save, and
  the fallback for a currency the registry has no row for — every foreign entry
  written before the registry existed, and any rate a group removes
  ([ADR-0005](decisions/0005-money-and-currency.md)).
- **An exchange rate is identified by its currency code**, the one entity whose
  id a person chooses rather than `newId()`. So its Dexie key is compound
  (`[groupId+id]`) — two trips both spending in MAD are two rows — and anything
  re-folding one entity has to scope by group as well as by id.
- A settlement (a **transfer**) is structurally separate from an expense so it
  never pollutes "how much did the trip cost". So is income, which is counted in
  `totalIncomeMinor` and never netted into `totalSpendMinor`.
- An attachment's binary lives in R2; until upload succeeds the blob is in a
  Dexie table keyed by attachment id.
- **Identity is one row per device**, keyed by the node id ending every HLC that
  device stamped. Claims are ops
  ([ADR-0003](decisions/0003-link-only-access.md)); the device's own
  pointer stays in `device.meByGroup`, unsynced — changing it appends the op.

## Splits — the only tricky arithmetic

Every mode resolves to `Record<memberId, minorAmount>` summing **exactly** to
`baseAmountMinor`. Not approximately. `core/split.ts`:

ideal share as an exact rational → floor to minor units → distribute the
remainder by **largest fractional part**, ties broken by a hash of
`${tiebreakSeed}:${memberId}` (callers pass the expense id, so the leftover cent
lands on a different person each time while staying identical across devices) →
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
`core/balance.ts` and nowhere else. Settle-up is a greedy largest-debtor↔largest-creditor match,
at most `n−1` transfers — not provably minimal (NP-hard), just good. Say
"simplest way to settle", never "optimal".

## D1 schema

The server stores the log and the attachment index. That is all — there is no
`expenses` table on the server, which is the whole point of
[ADR-0002](decisions/0002-append-only-op-log.md).

```sql
CREATE TABLE groups (
  id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL,   -- sha256, never the secret
  created_at INTEGER NOT NULL, last_op_seq INTEGER NOT NULL DEFAULT 0);

CREATE TABLE ops (
  seq INTEGER NOT NULL,          -- per-group, assigned by the server
  id TEXT PRIMARY KEY,           -- client UUID = idempotency key
  group_id TEXT NOT NULL REFERENCES groups(id),
  entity TEXT NOT NULL,          -- group|member|expense|settlement|attachment|
                                 -- identity|rate
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,            -- create|update|delete|restore
  patch TEXT NOT NULL,           -- JSON, changed fields only
  hlc TEXT NOT NULL,             -- lexicographically sortable
  actor TEXT NOT NULL,           -- memberId that made the change
  note TEXT, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX ops_group_seq ON ops(group_id, seq);
CREATE INDEX ops_group_entity ON ops(group_id, entity_id);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id),
  expense_id TEXT NOT NULL, r2_key TEXT NOT NULL, mime TEXT NOT NULL,
  bytes INTEGER NOT NULL, width INTEGER, height INTEGER,
  created_at INTEGER NOT NULL);
```

## IndexedDB (Dexie), schema v6

| Store | Key | Notes |
|---|---|---|
| `ops` | `id` | indexes on `groupId`, `entityId`, `hlc`, `pending`, `[groupId+hlc]` |
| `groups`, `members`, `expenses`, `settlements`, `attachments` | `id` | materialised, rebuildable from `ops` |
| `rates` | `[groupId+id]` | the group's exchange registry, `id` being the currency code |
| `identities` | `[groupId+id]` | one row per device per group, `id` being the device's node id |
| `device` | key | who "you" are, theme, HLC state, install-nudge dismissal |
| `groupKeys` | `groupId` | the invite secret and sync cursor. Never an op — [ADR-0003](decisions/0003-link-only-access.md) |

`identityLog` existed in v2 and is **dropped** — identity claims are ops now.
v5/v6 re-key `identities` from `id` to `[groupId+id]`, in two steps because
Dexie refuses to change a primary key in place.

The materialised stores are a **cache**: if a migration gets confusing, drop
them and re-fold from `ops`. Never migrate materialised data by hand — which is
why re-keying a table costs a drop and a `rebuild()`, not a data migration.

## Gotchas

- `Intl.NumberFormat` will happily render a float. Format from minor units via
  `core/money.ts`; don't reach for `toFixed`.
- **A device's identity id is its HLC node id** — one string per install, the
  same in every group it joins. So `identities` is keyed by `[groupId+id]`, like
  `rates`: keyed by the node id alone (as it was until Dexie v6) a phone in two
  groups had one row, and re-folding either group deleted the other's claim.
  Anything re-folding one entity has to scope by group as well as by id.
