# Data model

*For: anyone touching entities, money, splits, or the D1 schema.*

## Money

**Integer minor units. Always.** A money field is named `*_minor`/`*Minor` and
is an integer number of cents. No float anywhere represents money. Formatting
happens in the view layer and nowhere else. Currency codes are ISO 4217;
exponents vary (JPY 0, TND 3) and `core/money.ts` owns that table — never assume
2.

## Entities

Materialised by folding ops into IndexedDB tables. Authoritative nowhere on the
server.

```ts
Group      { id, name, baseCurrency, createdAt, archivedAt? }
Member     { id, groupId, name, colorSeed, isPlaceholder, deletedAt? }
Settlement { id, groupId, fromMember, toMember, amountMinor, currency,
             rateToBase, baseAmountMinor, occurredAt, createdAt?, note?, deletedAt? }
Attachment { id, groupId, expenseId, r2Key, mime, bytes, width, height,
             uploadState: 'local'|'uploading'|'uploaded', createdAt }
Identity   { id /* the device's HLC node id */, groupId, memberId, claimedAt }

Expense {
  id, groupId, description, categoryId, occurredAt,
  createdAt?,         // set once at creation; list-order tiebreak for
                      // same-day expenses, since occurredAt is user-editable
  amountMinor,        // in `currency`
  currency,           // ISO 4217, may differ from group base
  rateToBase,         // decimal string, "1" when same currency
  baseAmountMinor,    // amountMinor × rateToBase, rounded once, STORED
  paidBy,             // memberId — the payer, or the largest co-sponsor
  payers?,            // memberId -> minor units in THIS expense's currency,
                      // summing to amountMinor. Absent = one payer (ADR-0010)
  split: { mode: 'equal' | 'exact' | 'shares' | 'percent', ... },
  attachmentIds: string[],
  receiptItems?, receiptTip?, receiptInvolved?, receiptAssignments?,
                      // the parsed bill behind `split`, kept so the
                      // who-had-what grid can reopen (ADR-0017)
  splitTab?,          // 'equal'|'shares'|'exact'|'receipt' — which split
                      // editor tab was showing, so it survives save (ADR-0019)
  deletedAt?
}
```

Split payloads: `equal { members[] }`, `exact { amounts }`, `shares { weights }`,
`percent { percents }` (basis points). **`percent` is legacy and read-only** —
ops already on logs carry it, nothing writes it
([ADR-0013](decisions/0013-the-split-editor-is-part-of-the-expense-form.md)).
What a person calls each mode is `SPLIT_MODE_LABEL` in `apps/web/lib/format.ts`
and nowhere else — the tab strip, the expense screen and the ledger row all
read it from there.

- A member is a person, not an account. One with expenses attached is
  tombstoned, never hard-deleted, or the fold references nothing. Leaving a
  group is this, on yourself (a dialog on People), plus `device.leftGroups` (below) so
  it drops off *your* groups list even when others are still in it; when it
  empties the group, `Group.archivedAt` is also set in the same batch, which
  drops it off everyone's list. Either way the log survives, untouched, same
  as any other tombstone — opening the invite link again clears the hide.
- `baseAmountMinor` is **stored, not computed on read** — the rate is frozen at
  entry ([ADR-0005](decisions/0005-locked-fx-rate.md)) and must re-derive
  identically on every device.
- A settlement is structurally separate from an expense so it never pollutes
  "how much did the trip cost".
- An attachment's binary lives in R2; until upload succeeds the blob is in a
  Dexie table keyed by attachment id and the UI renders from there.
- **Identity is one row per device**, keyed by the node id ending every HLC that
  device stamped. Claims are ops
  ([ADR-0011](decisions/0011-identity-changes-are-public.md)); the device's own
  "am I Sam?" pointer stays in `device.meByGroup`, unsynced — changing it is
  what appends the op.

## Splits — the only tricky arithmetic

Every mode resolves to `Record<memberId, minorAmount>` summing **exactly** to
`baseAmountMinor`. Not approximately. `core/split.ts`:

ideal share as an exact rational → floor to minor units → distribute the
remainder by **largest fractional part**, ties broken by a hash of
`${tiebreakSeed}:${memberId}` (callers pass the expense id, so the leftover cent
lands on a different person each time while staying identical across devices) →
return the map plus `remainderAbsorbedBy`.

**`remainderAbsorbedBy` is diagnostic, not UI** — tests assert on it, screens
never render it. Determinism matters more than fairness: two phones folding the
same ops must produce byte-identical splits or balances diverge; the seeded draw
buys fairness inside that constraint.

**Test this hard:** €10 across 3, €0.01 across 4, a 3-decimal currency, percent
splits that don't sum to 100, exact splits that overshoot.

## Co-sponsored expenses

`payers` is the payer-side mirror of `split`, edited on `/g/payers` while the
split is inline on the expense form — *who put money in* and *who it was spent
on* are different questions ([ADR-0010](decisions/0010-co-sponsored-expenses.md)).
Amounts are in the **expense's own currency** and sum to `amountMinor`;
`resolvePayers()` apportions the stored `baseAmountMinor` at read time so the
payer side sums to it exactly; `paidBy` is kept in step as the largest
contributor (a map with one live contributor is stored as `null`); and a payer
need not be a participant — paying for a dinner you weren't at is the point.

## Balances and settle-up

Both **derived on read, never stored.** `balance(member) = Σ(paid) − Σ(share)`
in base minor units over expenses and settlements; the set always sums to zero
(assert it in dev). Settle-up is a greedy largest-debtor↔largest-creditor match,
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
  entity TEXT NOT NULL,          -- group|member|expense|settlement|attachment|identity
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

## IndexedDB (Dexie), schema v3

| Store | Key | Notes |
|---|---|---|
| `ops` | `id` | indexes on `[groupId+hlc]`, `[groupId+syncState]` |
| `groups`, `members`, `expenses`, `settlements`, `attachments`, `identities` | `id` | materialised, rebuildable from `ops` |
| `blobs` | `attachmentId` | queued image data awaiting upload |
| `device` | key | who "you" are, theme, HLC state, install-nudge dismissal |
| `groupKeys` | `groupId` | the invite secret and sync cursor. Never an op — [ADR-0003](decisions/0003-link-only-access.md) |

`identityLog` existed in v2 and is **dropped** — identity claims are ops now.
The materialised stores are a **cache**: if a migration gets confusing, drop
them and re-fold from `ops`. Never migrate materialised data by hand.

## Gotchas

- `Intl.NumberFormat` will happily render a float. Format from minor units via
  `core/money.ts`; don't reach for `toFixed`.
