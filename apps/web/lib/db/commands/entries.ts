import {
  canonicalSplit, newId, primaryPayer,
  type CurrencyCode, type ExpenseKind, type Id, type Rate, type ReceiptItem,
  type SplitSpec, type SplitTab,
} from "@hajsik/core";
import { db } from "../dexie";
import { appendOps } from "./append";
import { changedFields, only, setDerived } from "./patch";
import { revalue, rateToWrite, toBase, valuationOf } from "./rates";

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
  receiptInvolved?: Id[] | null;
  receiptAssignments?: Id[][] | null;
  /** Which split tab was showing when this expense was saved. */
  splitTab?: SplitTab | null;
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

export async function addExpense(
  groupId: Id,
  actor: Id,
  input: ExpenseInput,
  now = Date.now(),
): Promise<Id> {
  const { base, rates } = await valuationOf(groupId);
  const seed = { ...input, rateToBase: rateToWrite(input.currency, input.rateToBase, base, rates) };
  const payer = normalisePayers(input);
  const expenseId = newId();
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
            categoryId: input.categoryId,
            payers: payer.payers,
            attachmentIds: input.attachmentIds,
            receiptItems: input.receiptItems,
            receiptTip: input.receiptTip,
            receiptInvolved: input.receiptInvolved,
            receiptAssignments: input.receiptAssignments,
            splitTab: input.splitTab,
          }),
        },
      },
    ],
    now,
  );
  return expenseId;
}

/**
 * Edit an expense. The patch carries only the fields that actually changed —
 * that is what lets two people edit different fields of the same expense
 * offline and have both survive.
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

  // Both sides of the split comparison written one way. `sameValue` sorts
  // object keys but not array elements, so toggling a member out and back in
  // reordered `members` and was written as an edit that changed nothing a
  // person could see (`canonicalSplit`).
  const input: Partial<ExpenseInput> = changes.split
    ? { ...changes, split: canonicalSplit(changes.split) } : changes;
  const before = { ...existing, split: canonicalSplit(existing.split) };

  const patch = changedFields(before, input);

  // An expense is the *absence* of `kind` (see `addExpense`), but the form
  // always sends one — so without this every first edit of an expense wrote a
  // kind change against nothing, and the history read "turned this back into
  // an expense" over an edit that only moved the amount.
  if ("kind" in patch && (patch["kind"] ?? "expense") === (existing.kind ?? "expense")) {
    delete patch["kind"];
  }

  // The two payer fields move together — writing one without the other could
  // leave `paidBy` naming somebody who isn't in `payers` at all — but only the
  // ones that actually changed are written, or every payer edit would carry a
  // redundant `payers: null` into the log.
  if (patch["paidBy"] !== undefined || patch["payers"] !== undefined) {
    const payer = normalisePayers({ ...existing, ...input } as ExpenseInput);
    setDerived(patch, "paidBy", payer.paidBy, existing.paidBy);
    setDerived(patch, "payers", payer.payers, existing.payers ?? null);
  }

  await revalue(groupId, patch, existing, { ...existing, ...input } as ExpenseInput);

  if (Object.keys(patch).length === 0) return;
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
 * Edit a transfer. Same two rules as `editExpense`, by the same two functions:
 * only what changed reaches the log, and the base figure is re-derived — and
 * written only if it moved — whenever the amount, the currency or the rate does.
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

  const patch = changedFields(existing, changes);
  await revalue(groupId, patch, existing, { ...existing, ...changes });

  if (Object.keys(patch).length === 0) return;
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
