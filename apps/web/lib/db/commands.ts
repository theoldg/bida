import {
  buildRestorePatch,
  convertMinor,
  createHlcState,
  hlcSend,
  newColorSeed,
  newGroupSecret,
  newId,
  type CurrencyCode,
  type EntityKind,
  type Id,
  type Op,
  type OpKind,
  type Rate,
  type SplitSpec,
} from "@hajsik/core";
import { db, type StoredOp } from "./dexie";
import { getDevice, setMe } from "./device";
import { materialise, opsForGroup } from "./fold";

/**
 * Every write in the app goes through this file, and every function here
 * appends ops rather than editing rows. Components never touch Dexie directly.
 *
 * If you find yourself wanting to `db().expenses.put(...)` somewhere in a
 * component, what you actually want is a new function in here.
 */

export interface OpDraft {
  entity: EntityKind;
  entityId: Id;
  kind: OpKind;
  patch: Record<string, unknown>;
  note?: string | null;
}

/**
 * Append ops and materialise what they touched, atomically.
 *
 * The device's HLC is advanced inside the same transaction as the write, so a
 * tab that dies mid-command can't leave the clock ahead of the log.
 */
export async function appendOps(
  groupId: Id,
  actor: Id,
  drafts: readonly OpDraft[],
  now = Date.now(),
): Promise<Op[]> {
  const d = db();
  return d.transaction(
    "rw",
    [d.ops, d.device, d.groups, d.members, d.expenses, d.settlements, d.attachments],
    async () => {
      const device = await getDevice();
      let clock = createHlcState(device.nodeId, device.hlcPhysical, device.hlcCounter);

      const written: StoredOp[] = [];
      for (const draft of drafts) {
        const sent = hlcSend(clock, now);
        clock = sent.state;
        written.push({
          id: newId(),
          groupId,
          entity: draft.entity,
          entityId: draft.entityId,
          kind: draft.kind,
          patch: draft.patch,
          hlc: sent.hlc,
          actor,
          note: draft.note ?? null,
          createdAt: now,
          seq: null,
          pending: 1,
        });
      }

      await d.ops.bulkPut(written);
      await d.device.put({
        ...device,
        hlcPhysical: clock.physical,
        hlcCounter: clock.counter,
      });

      // Dedupe: two ops in one command often touch the same entity.
      const touched = new Map<Id, EntityKind>();
      for (const op of written) touched.set(op.entityId, op.entity);
      for (const [entityId, kind] of touched) await materialise(kind, entityId);

      return written;
    },
  );
}

// ---------------------------------------------------------------- groups

export interface NewGroupInput {
  name: string;
  baseCurrency: CurrencyCode;
  /** The person holding this device. Becomes the first member and the actor. */
  myName: string;
}

export async function createGroup(
  input: NewGroupInput,
  now = Date.now(),
): Promise<{ groupId: Id; memberId: Id; secret: string }> {
  const groupId = newId();
  const memberId = newId();
  const secret = newGroupSecret();

  await db().groupKeys.put({ groupId, secret, lastSeq: 0 });

  await appendOps(
    groupId,
    memberId,
    [
      {
        entity: "group",
        entityId: groupId,
        kind: "create",
        patch: {
          name: input.name,
          baseCurrency: input.baseCurrency,
          createdAt: now,
          archivedAt: null,
        },
      },
      {
        entity: "member",
        entityId: memberId,
        kind: "create",
        patch: { name: input.myName, colorSeed: newColorSeed(), deletedAt: null },
      },
    ],
    now,
  );

  await setMe(groupId, memberId);
  return { groupId, memberId, secret };
}

export async function renameGroup(groupId: Id, actor: Id, name: string): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "group", entityId: groupId, kind: "update", patch: { name } },
  ]);
}

export async function archiveGroup(groupId: Id, actor: Id, now = Date.now()): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "group", entityId: groupId, kind: "update", patch: { archivedAt: now } },
  ]);
}

// --------------------------------------------------------------- members

export async function addMember(groupId: Id, actor: Id, name: string): Promise<Id> {
  const memberId = newId();
  await appendOps(groupId, actor, [
    {
      entity: "member",
      entityId: memberId,
      kind: "create",
      patch: { name, colorSeed: newColorSeed(), deletedAt: null },
    },
  ]);
  return memberId;
}

export async function renameMember(
  groupId: Id,
  actor: Id,
  memberId: Id,
  name: string,
): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "member", entityId: memberId, kind: "update", patch: { name } },
  ]);
}

/**
 * Tombstone a member. Their past expenses stay exactly as they were — removing
 * someone must never silently redistribute money they already owed.
 */
export async function removeMember(groupId: Id, actor: Id, memberId: Id): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "member", entityId: memberId, kind: "delete", patch: {} },
  ]);
}

// -------------------------------------------------------------- expenses

export interface ExpenseInput {
  description: string;
  occurredAt: number;
  /** In `currency`, minor units. */
  amountMinor: number;
  currency: CurrencyCode;
  /** Frozen at entry. "1" when the expense is already in the base currency. */
  rateToBase: Rate;
  paidBy: Id;
  split: SplitSpec;
  categoryId?: string | null;
  attachmentIds?: Id[];
}

async function baseCurrencyOf(groupId: Id): Promise<CurrencyCode> {
  const group = await db().groups.get(groupId);
  if (!group) throw new Error(`unknown group: ${groupId}`);
  return group.baseCurrency;
}

/** The stored base amount, computed once at entry and never again. ADR-0005. */
function toBase(input: ExpenseInput, base: CurrencyCode): number {
  return input.currency === base
    ? input.amountMinor
    : convertMinor(input.amountMinor, input.currency, base, input.rateToBase);
}

export async function addExpense(
  groupId: Id,
  actor: Id,
  input: ExpenseInput,
  now = Date.now(),
): Promise<Id> {
  const base = await baseCurrencyOf(groupId);
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
          description: input.description,
          categoryId: input.categoryId ?? null,
          occurredAt: input.occurredAt,
          amountMinor: input.amountMinor,
          currency: input.currency,
          rateToBase: input.rateToBase,
          baseAmountMinor: toBase(input, base),
          paidBy: input.paidBy,
          split: input.split,
          attachmentIds: input.attachmentIds ?? [],
          deletedAt: null,
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

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value !== undefined) patch[key] = value;
  }

  // The amount, its currency or its rate changing all move the base figure.
  if (
    patch["amountMinor"] !== undefined ||
    patch["currency"] !== undefined ||
    patch["rateToBase"] !== undefined
  ) {
    const base = await baseCurrencyOf(groupId);
    const merged: ExpenseInput = { ...existing, ...changes } as ExpenseInput;
    patch["baseAmountMinor"] = toBase(merged, base);
  }

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
  const base = await baseCurrencyOf(groupId);
  const settlementId = newId();
  const baseAmountMinor =
    input.currency === base
      ? input.amountMinor
      : convertMinor(input.amountMinor, input.currency, base, input.rateToBase);

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
          rateToBase: input.rateToBase,
          baseAmountMinor,
          occurredAt: input.occurredAt,
          note: input.note ?? null,
          deletedAt: null,
        },
      },
    ],
    now,
  );
  return settlementId;
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

// -------------------------------------------------------------- history

/**
 * Roll an entity back to how it looked at `atHlc` — as a new op, appended like
 * any other. Nothing is ever rewound, so the rollback itself has a history.
 */
export async function restoreRevision(
  groupId: Id,
  actor: Id,
  entity: EntityKind,
  entityId: Id,
  atHlc: string,
  note?: string,
): Promise<void> {
  const ops = await opsForGroup(groupId);
  const patch = buildRestorePatch(ops, entityId, atHlc);
  if (Object.keys(patch).length === 0) return;
  await appendOps(groupId, actor, [
    { entity, entityId, kind: "restore", patch, note: note ?? null },
  ]);
}
