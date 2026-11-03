// Doc: docs/sync.md#the-operation
import {
  canonicalSplit, newId, partsBesideBill, primaryPayer, receiptOf, restoreEntryDrafts,
  type CurrencyCode, type EntryEntity, type EntryRateSource, type ExpenseKind, type Id, type OpDraft, type Rate,
  type Receipt, type SplitSpec,
} from "@bida/core";
import { db } from "../dexie";
import { groupState } from "../fold";
import { appendOps } from "./append";
import { movesAnything, only, wholeEntity } from "./patch";
import { baseOf, rateFields } from "./rates";

export interface ExpenseInput extends Receipt {
  kind?: ExpenseKind | null;
  description: string;
  occurredAt: number;
  /** True when `occurredAt` carries a day and no time — a backdated scan. */
  dateOnly?: boolean | null;
  amountMinor: number;
  currency: CurrencyCode;
  rateToBase: Rate;
  rateSource?: EntryRateSource | null;
  paidBy: Id;
  payers?: Record<Id, number> | null;
  split: SplitSpec;
  categoryId?: string | null;
  attachmentIds?: Id[] | null;
}

/**
 * With two or more contributors `paidBy` becomes the largest, so a row, an avatar
 * and an older client still have one answer (ADR-0010).
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

function write(groupId: Id, actor: Id, drafts: readonly OpDraft[], now = Date.now()) {
  return appendOps(groupId, actor, drafts, now, { notify: true });
}

/**
 * What a save does to the entry's kept photo (docs/photos.md): a new one
 * replaces whatever was kept, or none is kept. Absent leaves it alone.
 */
export type PhotoChange =
  | { keep: { id: Id; jpeg: string; bytes: number } }
  | { drop: true };

/**
 * The ops a photo change adds to the save, and its `attachmentIds`. The new
 * photo's bytes go into `photos` first, so they are on the phone before any op
 * names them; the ones replaced are queued for the server to drop once the
 * save is in (`dropPhotos`).
 */
async function photoOps(
  groupId: Id, expenseId: Id, held: readonly Id[], change: PhotoChange, now: number,
): Promise<{ drafts: OpDraft[]; attachmentIds: Id[] | null; dropped: Id[] }> {
  const kept = "keep" in change ? change.keep : null;
  const dropped = held.filter((id) => id !== kept?.id);
  const drafts: OpDraft[] = dropped.map((id) => ({
    entity: "attachment", entityId: id, kind: "delete", patch: {},
  }));
  if (kept && !held.includes(kept.id)) {
    await db().photos.put({ id: kept.id, groupId, jpeg: kept.jpeg, state: "upload" });
    drafts.unshift({
      entity: "attachment", entityId: kept.id, kind: "create",
      patch: { expenseId, mime: "image/jpeg", bytes: kept.bytes, createdAt: now },
    });
  }
  return { drafts, attachmentIds: kept ? [kept.id] : null, dropped };
}

/** After the save: a dropped photo's bytes leave this phone, and the server is asked to follow. */
async function dropPhotos(groupId: Id, ids: readonly Id[]): Promise<void> {
  if (ids.length === 0) return;
  await db().photos.bulkPut(ids.map((id) => ({ id, groupId, state: "delete" as const })));
}

/** A save that failed leaves no photo behind for nothing to name. */
async function unkeep(change: PhotoChange | undefined, held: readonly Id[]): Promise<void> {
  if (change && "keep" in change && !held.includes(change.keep.id)) await db().photos.delete(change.keep.id);
}

function liveIds(ids: readonly Id[] | null | undefined): Id[] {
  return [...(ids ?? [])];
}

function expenseContent(input: ExpenseInput, base: CurrencyCode) {
  const payer = normalisePayers(input);
  return {
    // An ordinary expense is the *absence* of `kind`, on every op ever appended.
    kind: input.kind === "income" ? "income" : null,
    description: input.description,
    occurredAt: input.occurredAt,
    dateOnly: input.dateOnly ? true : null,
    amountMinor: input.amountMinor,
    currency: input.currency,
    ...rateFields(input, base),
    paidBy: payer.paidBy,
    payers: payer.payers,
    // Canonical from the first op: `sameValue` sorts keys but not arrays, so
    // re-picking the same people would otherwise read as an edit.
    split: canonicalSplit(input.split),
    splitTab: partsBesideBill(input),
    categoryId: input.categoryId,
    attachmentIds: input.attachmentIds,
    ...receiptOf(input),
  };
}

export function expenseCreatePatch(input: ExpenseInput, base: CurrencyCode, now: number) {
  return { createdAt: now, ...only(expenseContent(input, base)) };
}

/**
 * `expenseId` comes from the caller: the leftover minor unit goes by that id
 * (`tiebreakSeed`), so the form must write under the id it quoted.
 */
export async function addExpense(
  groupId: Id,
  actor: Id,
  input: ExpenseInput,
  now = Date.now(),
  expenseId: Id = newId(),
  photo?: PhotoChange,
): Promise<Id> {
  const base = await baseOf(groupId);
  const pictured = photo ? await photoOps(groupId, expenseId, [], photo, now) : undefined;
  const content = pictured ? { ...input, attachmentIds: pictured.attachmentIds ?? undefined } : input;
  try {
    await write(groupId, actor, [
      ...(pictured?.drafts ?? []),
      { entity: "expense", entityId: expenseId, kind: "create", patch: expenseCreatePatch(content, base, now) },
    ], now);
  } catch (err) {
    await unkeep(photo, []);
    throw err;
  }
  return expenseId;
}

/**
 * The patch carries the **whole** entry, so every version anybody sees is one a
 * person looked at (ADR-0002).
 */
export async function editExpense(
  groupId: Id,
  actor: Id,
  expenseId: Id,
  changes: Partial<ExpenseInput>,
  photo?: PhotoChange,
): Promise<void> {
  const existing = await db().expenses.get(expenseId);
  if (!existing) throw new Error(`unknown expense: ${expenseId}`);

  const now = Date.now();
  const base = await baseOf(groupId);
  const kept = liveIds(existing.attachmentIds);
  const pictured = photo ? await photoOps(groupId, expenseId, kept, photo, now) : undefined;
  const patch = wholeEntity(expenseContent({
    ...existing, ...changes, ...(pictured ? { attachmentIds: pictured.attachmentIds } : {}),
  }, base));

  // A save that moved nothing is a revision saying nothing happened — compared
  // against the stored split made canonical too.
  const held = { ...existing, split: canonicalSplit(existing.split), splitTab: partsBesideBill(existing) };
  if (!movesAnything(held, patch)) return;
  try {
    await write(groupId, actor, [
      ...(pictured?.drafts ?? []),
      { entity: "expense", entityId: expenseId, kind: "update", patch },
    ], now);
  } catch (err) {
    await unkeep(photo, kept);
    throw err;
  }
  await dropPhotos(groupId, pictured?.dropped ?? []);
}

export async function deleteExpense(
  groupId: Id,
  actor: Id,
  expenseId: Id,
): Promise<void> {
  await write(groupId, actor, [
    { entity: "expense", entityId: expenseId, kind: "delete", patch: {} },
  ]);
}

// ----------------------------------------------------------- settlements

export interface SettlementInput {
  fromMember: Id;
  toMember: Id;
  amountMinor: number;
  currency: CurrencyCode;
  rateToBase: Rate;
  rateSource?: EntryRateSource | null;
  occurredAt: number;
  dateOnly?: boolean | null;
  note?: string | null;
}

function settlementContent(input: SettlementInput, base: CurrencyCode) {
  return {
    fromMember: input.fromMember,
    toMember: input.toMember,
    amountMinor: input.amountMinor,
    currency: input.currency,
    ...rateFields(input, base),
    occurredAt: input.occurredAt,
    dateOnly: input.dateOnly ? true : null,
    note: input.note,
  };
}

export function settlementCreatePatch(input: SettlementInput, base: CurrencyCode, now: number) {
  return { createdAt: now, ...only(settlementContent(input, base)) };
}

export async function recordSettlement(
  groupId: Id,
  actor: Id,
  input: SettlementInput,
  now = Date.now(),
): Promise<Id> {
  const base = await baseOf(groupId);
  const settlementId = newId();
  await write(
    groupId,
    actor,
    [{
      entity: "settlement", entityId: settlementId, kind: "create",
      patch: settlementCreatePatch(input, base, now),
    }],
    now,
  );
  return settlementId;
}

export async function editSettlement(
  groupId: Id,
  actor: Id,
  settlementId: Id,
  changes: Partial<SettlementInput>,
): Promise<void> {
  const existing = await db().settlements.get(settlementId);
  if (!existing) throw new Error(`unknown settlement: ${settlementId}`);

  const base = await baseOf(groupId);
  const patch = wholeEntity(settlementContent({ ...existing, ...changes }, base));

  if (!movesAnything(existing, patch)) return;
  await write(groupId, actor, [
    { entity: "settlement", entityId: settlementId, kind: "update", patch },
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
 * One append, so the group is never left holding a live entry naming nobody
 * (ADR-0031).
 */
export async function restoreEntry(groupId: Id, actor: Id, entity: EntryEntity, entryId: Id): Promise<void> {
  const drafts = restoreEntryDrafts(await groupState(groupId), entity, entryId);
  if (drafts.length > 0) await write(groupId, actor, drafts);
}
