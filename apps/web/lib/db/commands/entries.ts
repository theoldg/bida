import {
  canonicalSplit, newId, primaryPayer,
  type CurrencyCode, type ExpenseKind, type Id, type Rate, type ReceiptDiscount, type ReceiptItem,
  type SplitSpec,
} from "@bida/core";
import { db } from "../dexie";
import { appendOps } from "./append";
import { movesAnything, only, wholeEntity } from "./patch";
import { rateToWrite, toBase, valuationOf } from "./rates";

/**
 * The three kinds of entry — expense, income and transfer (ADR-0010) — added,
 * edited and tombstoned. Everything in the app that moves money lands here.
 *
 * The two editors are deliberately the same shape: diff the form against what
 * is stored (`patch.ts`), then let the registry re-derive what the change is
 * worth (`rates.ts`). Neither step is written out twice.
 */

export interface ExpenseInput {
  /** Which way the entry runs. Omitted or "expense" for the ordinary case. */
  kind?: ExpenseKind | null;
  description: string;
  occurredAt: number;
  /** True when `occurredAt` carries a day and no time — a backdated scan. */
  dateOnly?: boolean | null;
  /** In `currency`, minor units. */
  amountMinor: number;
  currency: CurrencyCode;
  /** Frozen at entry. "1" when the expense is already in the base currency. */
  rateToBase: Rate;
  paidBy: Id;
  /** Co-sponsors, in `currency` minor units. Omit or null for a single payer. */
  payers?: Record<Id, number> | null;
  split: SplitSpec;
  categoryId?: string | null;
  attachmentIds?: Id[];
  /** The parsed bill behind `split`, kept so the who-had-what grid can reopen. */
  receiptItems?: ReceiptItem[] | null;
  receiptTip?: string | null;
  receiptTax?: string | null;
  receiptDiscounts?: ReceiptDiscount[] | null;
  receiptInvolved?: Id[] | null;
  receiptAssignments?: Id[][] | null;
}

/**
 * Normalise the payer side before it is written.
 *
 * A `payers` map with one contributor is just a single payer and is stored as
 * null, so the common case never carries a redundant field. With two or more,
 * `paidBy` is rewritten as the largest contributor so a list row, an avatar and
 * an older client all still have one sensible answer. ADR-0010.
 */
function normalisePayers(input: ExpenseInput): { paidBy: Id; payers: Record<Id, number> | null } {
  const spec = input.payers;
  if (!spec) return { paidBy: input.paidBy, payers: null };
  const live = Object.fromEntries(
    Object.entries(spec).filter(([, amount]) => amount > 0),
  );
  const ids = Object.keys(live);
  if (ids.length === 0) return { paidBy: input.paidBy, payers: null };
  if (ids.length === 1) return { paidBy: ids[0]!, payers: null };
  return { paidBy: primaryPayer(live, input.paidBy), payers: live };
}

/**
 * `expenseId` is the caller's to give, because the form that quoted the split
 * has to write it under the id it quoted: the leftover minor unit goes by
 * `tiebreakSeed`, which is that id (core/split.ts, `splitSeed` in lib/draft).
 * Left out, one is minted here.
 */
export async function addExpense(
  groupId: Id,
  actor: Id,
  input: ExpenseInput,
  now = Date.now(),
  expenseId: Id = newId(),
): Promise<Id> {
  const { base, rates } = await valuationOf(groupId);
  const seed = { ...input, rateToBase: rateToWrite(input.currency, input.rateToBase, base, rates) };
  const payer = normalisePayers(input);
  await appendOps(
    groupId,
    actor,
    [
      {
        entity: "expense",
        entityId: expenseId,
        kind: "create",
        patch: {
          // Written only for an income: an ordinary expense is the absence of
          // this field, on every op ever appended, and stays that way.
          ...(input.kind === "income" ? { kind: "income" } : {}),
          description: input.description,
          occurredAt: input.occurredAt,
          createdAt: now,
          amountMinor: input.amountMinor,
          currency: input.currency,
          rateToBase: seed.rateToBase,
          baseAmountMinor: toBase(seed, base),
          paidBy: payer.paidBy,
          // Canonical from the very first op, so an edit that re-picks the same
          // people compares equal to it — see `canonicalSplit`.
          split: canonicalSplit(input.split),
          // Absent on an ordinary expense — see `only`. No `deletedAt` either:
          // the id is fresh, so a create is never a tombstone.
          ...only({
            dateOnly: input.dateOnly ? true : null,
            categoryId: input.categoryId,
            payers: payer.payers,
            attachmentIds: input.attachmentIds,
            receiptItems: input.receiptItems,
            receiptTip: input.receiptTip,
            receiptTax: input.receiptTax,
            receiptDiscounts: input.receiptDiscounts,
            receiptInvolved: input.receiptInvolved,
            receiptAssignments: input.receiptAssignments,
          }),
        },
      },
    ],
    now,
  );
  return expenseId;
}

/**
 * Edit an expense. The patch carries the **whole** entry, not just what moved:
 * the last edit wins the entity, so every version anybody sees is one a person
 * actually looked at (`patch.ts`, ADR-0002).
 */
export async function editExpense(
  groupId: Id,
  actor: Id,
  expenseId: Id,
  changes: Partial<ExpenseInput>,
  note?: string,
): Promise<void> {
  const existing = await db().expenses.get(expenseId);
  if (!existing) throw new Error(`unknown expense: ${expenseId}`);

  const merged = { ...existing, ...changes } as ExpenseInput & { deletedAt?: number | null };
  // Both sides of the split comparison written one way. `sameValue` sorts
  // object keys but not array elements, so toggling a member out and back in
  // reordered `members` and read as an edit that changed nothing a person
  // could see (`canonicalSplit`).
  const split = canonicalSplit(merged.split);
  const before = { ...existing, split: canonicalSplit(existing.split) };

  // The payer fields are derived together — `paidBy` must never name somebody
  // who isn't in `payers` — and a whole write carries both regardless.
  const payer = normalisePayers({ ...merged, split });
  const { base, rates } = await valuationOf(groupId);
  const rateToBase = rateToWrite(merged.currency, merged.rateToBase, base, rates);

  const patch = wholeEntity({
    // An expense is the *absence* of `kind` (see `addExpense`), so an ordinary
    // one writes null rather than "expense": the two are the same value to the
    // fold, and null is what every op already written means.
    kind: merged.kind === "income" ? "income" : null,
    description: merged.description,
    occurredAt: merged.occurredAt,
    dateOnly: merged.dateOnly ? true : null,
    amountMinor: merged.amountMinor,
    currency: merged.currency,
    rateToBase,
    baseAmountMinor: toBase({ ...merged, rateToBase }, base),
    paidBy: payer.paidBy,
    payers: payer.payers,
    split,
    categoryId: merged.categoryId,
    attachmentIds: merged.attachmentIds,
    receiptItems: merged.receiptItems,
    receiptTip: merged.receiptTip,
    receiptTax: merged.receiptTax,
    receiptDiscounts: merged.receiptDiscounts,
    receiptInvolved: merged.receiptInvolved,
    receiptAssignments: merged.receiptAssignments,
  });

  // A save that moved nothing is a revision saying nothing happened.
  if (!movesAnything(before, patch)) return;
  await appendOps(groupId, actor, [
    { entity: "expense", entityId: expenseId, kind: "update", patch, note: note ?? null },
  ]);
}

export async function deleteExpense(
  groupId: Id,
  actor: Id,
  expenseId: Id,
  note?: string,
): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "expense", entityId: expenseId, kind: "delete", patch: {}, note: note ?? null },
  ]);
}

// ----------------------------------------------------------- settlements

export interface SettlementInput {
  fromMember: Id;
  toMember: Id;
  amountMinor: number;
  currency: CurrencyCode;
  rateToBase: Rate;
  occurredAt: number;
  note?: string | null;
}

export async function recordSettlement(
  groupId: Id,
  actor: Id,
  input: SettlementInput,
  now = Date.now(),
): Promise<Id> {
  const { base, rates } = await valuationOf(groupId);
  const settlementId = newId();
  const seed = { ...input, rateToBase: rateToWrite(input.currency, input.rateToBase, base, rates) };

  await appendOps(
    groupId,
    actor,
    [
      {
        entity: "settlement",
        entityId: settlementId,
        kind: "create",
        patch: {
          fromMember: input.fromMember,
          toMember: input.toMember,
          amountMinor: input.amountMinor,
          currency: input.currency,
          rateToBase: seed.rateToBase,
          baseAmountMinor: toBase(seed, base),
          occurredAt: input.occurredAt,
          createdAt: now,
          ...only({ note: input.note }),
        },
      },
    ],
    now,
  );
  return settlementId;
}

/**
 * Edit a transfer. The same rule as `editExpense`, by the same functions: the
 * whole entry reaches the log, and the base figure is re-derived from the
 * registry rather than carried over.
 */
export async function editSettlement(
  groupId: Id,
  actor: Id,
  settlementId: Id,
  changes: Partial<SettlementInput>,
  note?: string,
): Promise<void> {
  const existing = await db().settlements.get(settlementId);
  if (!existing) throw new Error(`unknown settlement: ${settlementId}`);

  const merged = { ...existing, ...changes };
  const { base, rates } = await valuationOf(groupId);
  const rateToBase = rateToWrite(merged.currency, merged.rateToBase, base, rates);

  const patch = wholeEntity({
    fromMember: merged.fromMember,
    toMember: merged.toMember,
    amountMinor: merged.amountMinor,
    currency: merged.currency,
    rateToBase,
    baseAmountMinor: toBase({ ...merged, rateToBase }, base),
    occurredAt: merged.occurredAt,
    note: merged.note,
  });

  if (!movesAnything(existing, patch)) return;
  await appendOps(groupId, actor, [
    { entity: "settlement", entityId: settlementId, kind: "update", patch, note: note ?? null },
  ]);
}

export async function deleteSettlement(
  groupId: Id,
  actor: Id,
  settlementId: Id,
): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "settlement", entityId: settlementId, kind: "delete", patch: {} },
  ]);
}
