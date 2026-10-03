import {
  canonicalSplit, newId, primaryPayer, receiptOf, restoreEntryDrafts,
  type CurrencyCode, type EntryEntity, type ExchangeRate, type ExpenseKind, type Id, type OpDraft, type Rate,
  type Receipt, type SplitSpec,
} from "@bida/core";
import { db } from "../dexie";
import { groupState } from "../fold";
import { appendOps } from "./append";
import { movesAnything, only, wholeEntity } from "./patch";
import { rateToWrite, toBase, valuationOf } from "./rates";

/**
 * The three kinds of entry (ADR-0010) — added, edited, tombstoned and put back.
 * Everything that moves money lands here. Both editors diff the form against
 * what is stored (`patch.ts`), then let the registry re-derive what the
 * change is worth (`rates.ts`).
 */

export interface ExpenseInput extends Receipt {
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
}

/**
 * Normalise the payer side before it is written. One contributor is a single
 * payer, stored as null `payers`. With two or more, `paidBy` becomes the
 * largest contributor, so a row, an avatar and an older client still have one
 * answer. ADR-0010.
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
 * Every write in this file: a person's own command about an entry, so the rest
 * of the group may hear of it (`appendOps`'s `notify`).
 */
function write(groupId: Id, actor: Id, drafts: readonly OpDraft[], now = Date.now()) {
  return appendOps(groupId, actor, drafts, now, { notify: true });
}

/**
 * An expense's content as both writes put it: the payer side normalised, the
 * split canonical, the base figure re-derived from the registry. A create and
 * an edit differ only in what they do with an absence (`only`, `wholeEntity`).
 */
function expenseContent(
  input: ExpenseInput, base: CurrencyCode, rates: Record<CurrencyCode, ExchangeRate>,
) {
  const rateToBase = rateToWrite(input.currency, input.rateToBase, base, rates);
  // The payer fields are derived together — `paidBy` must never name somebody
  // who isn't in `payers`.
  const payer = normalisePayers(input);
  return {
    // An ordinary expense is the *absence* of `kind`, on every op ever
    // appended: null here, which a create leaves off and an edit writes.
    kind: input.kind === "income" ? "income" : null,
    description: input.description,
    occurredAt: input.occurredAt,
    dateOnly: input.dateOnly ? true : null,
    amountMinor: input.amountMinor,
    currency: input.currency,
    rateToBase,
    baseAmountMinor: toBase({ ...input, rateToBase }, base),
    paidBy: payer.paidBy,
    payers: payer.payers,
    // Canonical from the very first op: `sameValue` sorts object keys but not
    // arrays, so re-picking the same people would otherwise read as an edit.
    split: canonicalSplit(input.split),
    categoryId: input.categoryId,
    attachmentIds: input.attachmentIds,
    ...receiptOf(input),
  };
}

/**
 * The `create` patch for an expense — the form's and the importer's. Absent
 * fields are left off (`only`); no `deletedAt` either, since a fresh id is
 * never a tombstone.
 */
export function expenseCreatePatch(
  input: ExpenseInput, base: CurrencyCode, rates: Record<CurrencyCode, ExchangeRate>, now: number,
) {
  return { createdAt: now, ...only(expenseContent(input, base, rates)) };
}

/**
 * `expenseId` comes from the caller, because the leftover minor unit goes by
 * `tiebreakSeed`, which is that id (core/split.ts, `splitSeed` in lib/draft):
 * the form must write under the id it quoted. Minted here if absent.
 */
export async function addExpense(
  groupId: Id,
  actor: Id,
  input: ExpenseInput,
  now = Date.now(),
  expenseId: Id = newId(),
): Promise<Id> {
  const { base, rates } = await valuationOf(groupId);
  await write(
    groupId,
    actor,
    [{ entity: "expense", entityId: expenseId, kind: "create", patch: expenseCreatePatch(input, base, rates, now) }],
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

  const { base, rates } = await valuationOf(groupId);
  const patch = wholeEntity(expenseContent({ ...existing, ...changes }, base, rates));

  // A save that moved nothing is a revision saying nothing happened — measured
  // against the stored split made canonical too, as the patch's is.
  if (!movesAnything({ ...existing, split: canonicalSplit(existing.split) }, patch)) return;
  await write(groupId, actor, [
    { entity: "expense", entityId: expenseId, kind: "update", patch, note: note ?? null },
  ]);
}

export async function deleteExpense(
  groupId: Id,
  actor: Id,
  expenseId: Id,
  note?: string,
): Promise<void> {
  await write(groupId, actor, [
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
  /** True when `occurredAt` carries a day and no time — see `ExpenseInput`. */
  dateOnly?: boolean | null;
  note?: string | null;
}

/** A transfer's content as both writes put it — see `expenseContent`. */
function settlementContent(
  input: SettlementInput, base: CurrencyCode, rates: Record<CurrencyCode, ExchangeRate>,
) {
  const rateToBase = rateToWrite(input.currency, input.rateToBase, base, rates);
  return {
    fromMember: input.fromMember,
    toMember: input.toMember,
    amountMinor: input.amountMinor,
    currency: input.currency,
    rateToBase,
    baseAmountMinor: toBase({ ...input, rateToBase }, base),
    occurredAt: input.occurredAt,
    dateOnly: input.dateOnly ? true : null,
    note: input.note,
  };
}

/** The `create` patch for a transfer — the form's and the importer's. */
export function settlementCreatePatch(
  input: SettlementInput, base: CurrencyCode, rates: Record<CurrencyCode, ExchangeRate>, now: number,
) {
  return { createdAt: now, ...only(settlementContent(input, base, rates)) };
}

export async function recordSettlement(
  groupId: Id,
  actor: Id,
  input: SettlementInput,
  now = Date.now(),
): Promise<Id> {
  const { base, rates } = await valuationOf(groupId);
  const settlementId = newId();
  await write(
    groupId,
    actor,
    [{
      entity: "settlement", entityId: settlementId, kind: "create",
      patch: settlementCreatePatch(input, base, rates, now),
    }],
    now,
  );
  return settlementId;
}

/**
 * Edit a transfer, by `editExpense`'s rule: the whole entry reaches the log,
 * and the base figure is re-derived from the registry.
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

  const { base, rates } = await valuationOf(groupId);
  const patch = wholeEntity(settlementContent({ ...existing, ...changes }, base, rates));

  if (!movesAnything(existing, patch)) return;
  await write(groupId, actor, [
    { entity: "settlement", entityId: settlementId, kind: "update", patch, note: note ?? null },
  ]);
}

export async function deleteSettlement(
  groupId: Id,
  actor: Id,
  settlementId: Id,
): Promise<void> {
  await write(groupId, actor, [
    { entity: "settlement", entityId: settlementId, kind: "delete", patch: {} },
  ]);
}

// ------------------------------------------------------------ restoring

/**
 * A deleted entry, back whole (ADR-0031), with anybody or any rate it names
 * that was removed since — the entry wins, as it does after a merge
 * (`restoreEntryDrafts`). One append, so the group is never left holding a
 * live entry that names nobody.
 */
export async function restoreEntry(groupId: Id, actor: Id, entity: EntryEntity, entryId: Id): Promise<void> {
  const drafts = restoreEntryDrafts(await groupState(groupId), entity, entryId);
  if (drafts.length > 0) await write(groupId, actor, drafts);
}
