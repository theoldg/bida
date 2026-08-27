# Data model

*For: anyone touching entities, money, splits, or the D1 schema.*

## Money

**Integer minor units. Always. Everywhere.** A field holding money is named
`*_minor` and is an integer number of cents. There is no float anywhere in this
codebase that represents money. Formatting to `€57,10` happens in the view layer
and nowhere else.

Currency codes are ISO 4217 strings. Minor-unit exponents vary (JPY has 0, TND
has 3) — `packages/core/money.ts` owns that table. Do not assume 2.

## Entities

Entities are *materialised* — they are the result of folding ops, and they exist
as tables in IndexedDB (for reading) and nowhere authoritative on the server.

### Group
```ts
{ id, name, baseCurrency, createdAt, archivedAt? }
```

### Member
```ts
{ id, groupId, name, colorSeed, isPlaceholder, deletedAt? }
```
A member is a *person in the group*, not a user account. There are no user
accounts ([ADR-0003](decisions/0003-link-only-access.md)). On a given device,
one member is marked as "you" — stored in local device settings, not synced.

A member with expenses attached can never be hard-deleted, only tombstoned;
otherwise the fold produces expenses referencing nothing.

### Expense
```ts
{
  id, groupId,
  description, categoryId, occurredAt,
  amountMinor,            // in `currency`
  currency,               // ISO 4217, may differ from group base
  rateToBase,             // decimal string, e.g. "0.0921"; "1" when same currency
  baseAmountMinor,        // amountMinor × rateToBase, rounded once, stored
  paidBy,                 // memberId — the payer, or the largest co-sponsor
  payers?,                // memberId -> minor units in THIS expense's currency,
                          // summing to amountMinor. Absent = one payer. ADR-0010
  split: {
    mode: 'equal' | 'exact' | 'shares' | 'percent',
    // equal:   { members: memberId[] }
    // exact:   { amounts: Record<memberId, minor> }
    // shares:  { weights: Record<memberId, number> }
    // percent: { percents: Record<memberId, number> }  // basis points internally
  },
  attachmentIds: string[],
  deletedAt?
}
```

`baseAmountMinor` is **stored, not computed on read** — the rate is frozen at
entry time ([ADR-0005](decisions/0005-locked-fx-rate.md)) and re-deriving it
later must give the same answer on every device.

### Settlement
A recorded real-world reimbursement. Structurally simpler than an expense and
kept separate so it never pollutes "how much did the trip cost".
```ts
{ id, groupId, fromMember, toMember, amountMinor, currency, rateToBase,
  baseAmountMinor, occurredAt, note?, deletedAt? }
```

### Attachment
```ts
{ id, groupId, expenseId, r2Key, mime, bytes, width, height,
  uploadState: 'local' | 'uploading' | 'uploaded', createdAt }
```
The binary lives in R2. Until upload succeeds, the blob lives in a separate
Dexie table keyed by attachment id, and the UI renders it from there.

## Splits — the only tricky arithmetic

Every split mode resolves to `Record<memberId, minorAmount>` summing **exactly**
to the expense's `baseAmountMinor`. Not approximately. Exactly.

The algorithm (`packages/core/split.ts`):

1. Compute each member's ideal share as an exact rational.
2. Floor each to minor units.
3. Distribute the remaining cents by **largest fractional remainder**. Ties are
   broken by a hash of `${tiebreakSeed}:${memberId}` — callers pass the expense
   id as the seed, so the leftover cent lands on a different person each time
   while staying identical on every device.
4. Return the map plus `remainderAbsorbedBy: memberId[]`.

**`remainderAbsorbedBy` is diagnostic, not UI.** Tests assert on it; screens do
not render it. Surfacing "€0,01 → Ada" turns a rounding artefact into an
accusation, and the owner has asked for the opposite — see
[standing-instructions](standing-instructions.md#dont-make-a-feature-of-the-odd-cent).
The rotation is meant to be noticed by nobody, or by one person, once.

Determinism matters more than fairness here: two phones folding the same ops
must produce byte-identical splits, or balances diverge. The seeded draw buys
fairness *inside* that constraint — without it, ties always break by ascending
member id and the alphabetically-first member subsidises every split in the
group.

**Test this hard.** €10 across 3 people, €0.01 across 4, a 3-decimal currency,
percent splits that don't sum to 100, exact splits that overshoot.

## Balances and settle-up

Both are **derived on read, never stored.**

- `balance(member) = Σ(paid) − Σ(share)` over expenses and settlements, in base
  currency minor units. The set always sums to zero; assert it in dev.
- Settle-up uses a greedy largest-debtor↔largest-creditor match, producing at
  most `n−1` transfers. This is not provably minimal (that problem is NP-hard),
  it's just good — say "simplest way to settle", never "optimal".

## D1 schema

The server stores the log and the attachment index. That is all.

```sql
CREATE TABLE groups (
  id            TEXT PRIMARY KEY,
  secret_hash   TEXT NOT NULL,        -- sha256 of the link secret; never the secret
  created_at    INTEGER NOT NULL,
  last_op_seq   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE ops (
  seq        INTEGER NOT NULL,        -- per-group, assigned by the server
  id         TEXT PRIMARY KEY,        -- client-generated UUID = idempotency key
  group_id   TEXT NOT NULL REFERENCES groups(id),
  entity     TEXT NOT NULL,           -- 'group'|'member'|'expense'|'settlement'|'attachment'
  entity_id  TEXT NOT NULL,
  kind       TEXT NOT NULL,           -- 'create'|'update'|'delete'|'restore'
  patch      TEXT NOT NULL,           -- JSON, changed fields only
  hlc        TEXT NOT NULL,           -- hybrid logical clock, lexicographically sortable
  actor      TEXT NOT NULL,           -- memberId that made the change
  note       TEXT,                    -- optional human reason: "forgot the rug"
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ops_group_seq ON ops(group_id, seq);
CREATE INDEX ops_group_entity ON ops(group_id, entity_id);

CREATE TABLE attachments (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id),
  expense_id TEXT NOT NULL,
  r2_key     TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  width      INTEGER, height INTEGER,
  created_at INTEGER NOT NULL
);
```

There is no `expenses` table on the server. That is intentional and is the whole
point of [ADR-0002](decisions/0002-append-only-op-log.md).

## Co-sponsored expenses

`payers` is the payer-side mirror of `split`, and the two are edited on two
sibling screens (`/g/payers`, `/g/split`) so they can never be confused for one
another: *who put the money in* and *who the money was spent on* are different
questions and often have different answers.

- Amounts are in the **expense's own currency** and must sum to `amountMinor`.
- `resolvePayers()` converts them to base minor units at read time, apportioning
  the stored `baseAmountMinor` so the payer side sums to it exactly.
- `paidBy` is always kept in step as the largest contributor; a payer map that
  ends up with one live contributor is stored as `null` instead.
- A payer need not be a participant. Paying for a dinner you weren't at is the
  point of the feature.

Reasoning, and the two designs rejected, in
[ADR-0010](decisions/0010-co-sponsored-expenses.md).

## IndexedDB schema (Dexie)

| Store | Key | Notes |
|---|---|---|
| `ops` | `id` | index on `[groupId+hlc]`, `[groupId+syncState]` |
| `groups`, `members`, `expenses`, `settlements`, `attachments` | `id` | materialised, rebuildable from `ops` at any time |
| `blobs` | `attachmentId` | queued image data awaiting upload |
| `device` | key | which member is "you", personal-mode toggle, theme, HLC state |
| `groupKeys` | `groupId` | the invite secret and the sync cursor. Never an op — [ADR-0003](decisions/0003-link-only-access.md) |
| `identityLog` | `++id` | this phone's identity changes per group (schema v2). Device-local — [ADR-0009](decisions/0009-identity-is-device-local.md) |

The materialised stores are a **cache**. If a migration gets confusing, the
correct fix is to drop them and re-fold from `ops`. Never migrate materialised
data by hand.

## Gotchas

*Add to this list every time one bites you.*

- `Intl.NumberFormat` will happily render a float. Format from minor units via
  the helper in `core/money.ts`; don't reach for `toFixed`.
