import {
  colorSeedFor, memberIdFor, newGroupId, newGroupSecret, newId, shapeEntry, shapeTransfer,
  type CurrencyCode, type Id, type ImportPlan, type OpDraft, type PlannedEntry, type PlannedTransfer, type RateFor,
} from "@bida/core";
import { appendOps } from "./append";
import { expenseCreatePatch, settlementCreatePatch } from "./entries";
import { saveGroupKey } from "./groups";
import { getDevice, setMe } from "../device";

/**
 * A plan from `core/import.ts`, written as a group.
 *
 * **One batch, one HLC run**, like `createGroup`: the history reads as one
 * import, and it is atomic — a tab dying halfway can't leave half a ledger.
 *
 * **Nothing new for sync.** Every row is an ordinary `create` under one actor;
 * there is no import op kind for the merge rules to learn.
 *
 * **Into a new group only.** Merging into an existing group would mean
 * matching rows to entries, and the file carries no ids to match with.
 */

export interface ImportGroupInput {
  /** What to call it. The shape has nowhere to say, so the screen asks. */
  name: string;
  /** Who is holding this phone. Must be one of `plan.members`, which the screen's add row may have grown. */
  myName: string;
  /** The rates a plan in several currencies needs (`lib/import/rates.ts`). */
  rateFor?: RateFor;
}

/**
 * Names to member ids by `memberIdFor` (a hash of group id and name), the same
 * derivation every write uses — so the ids are settled before any op is built
 * and the import can be one batch.
 */
function idsFor(groupId: Id, names: readonly string[]): Map<string, Id> {
  return new Map(names.map((name) => [name, memberIdFor(groupId, name)]));
}

export async function importGroup(
  plan: ImportPlan,
  input: ImportGroupInput,
  now = Date.now(),
): Promise<{ groupId: Id; memberId: Id; secret: string }> {
  const groupId = newGroupId();
  const ids = idsFor(groupId, plan.members);
  const me = ids.get(input.myName);
  if (!me) throw new Error(`importGroup: ${input.myName} is not one of the file's people`);

  const secret = newGroupSecret();
  await saveGroupKey(groupId, secret);
  const device = await getDevice();

  const drafts: OpDraft[] = [
    {
      entity: "group",
      entityId: groupId,
      kind: "create",
      patch: {
        name: input.name,
        baseCurrency: plan.currency,
        createdAt: now,
        archivedAt: null,
        importedFrom: plan.source,
      },
    },
    // Everyone on the plan, all as current members: the shape has no way to
    // say someone left.
    ...plan.members.map((name): OpDraft => ({
      entity: "member",
      entityId: ids.get(name)!,
      kind: "create",
      patch: { name, colorSeed: colorSeedFor(groupId, name), deletedAt: null },
    })),
    {
      entity: "identity",
      entityId: device.nodeId,
      kind: "create",
      patch: { memberId: me, claimedAt: now },
    },
    ...plan.entries.map((e) => expenseDraft(e, ids, plan.currency, now, input.rateFor)),
    ...plan.transfers.map((t) => transferDraft(t, ids, plan.currency, now, input.rateFor)),
  ];

  await appendOps(groupId, me, drafts, now);
  await setMe(groupId, me);
  return { groupId, memberId: me, secret };
}

/**
 * One row as an expense op, built by the same `create` patch the form writes.
 * `shapeEntry` picks its currency, rate, split mode and id — Evenly or Parts
 * where those land every cent where the source did, in the currency it was
 * spent in where a rate reproduces the base figure — and verifies the result
 * reads back as the plan's figures.
 */
function expenseDraft(
  e: PlannedEntry,
  ids: Map<string, Id>,
  base: CurrencyCode,
  now: number,
  rateFor?: RateFor,
): OpDraft {
  const shape = shapeEntry(e, base, (name) => ids.get(name)!, { newId, rateFor });
  return {
    entity: "expense",
    entityId: shape.id,
    kind: "create",
    patch: expenseCreatePatch({
      kind: e.kind,
      description: e.description,
      occurredAt: e.occurredAt,
      // The row's own day, not the day it was imported: the ledger is the
      // trip, and `createdAt` is where "this arrived today" lives.
      dateOnly: true,
      amountMinor: shape.amountMinor,
      currency: shape.currency,
      rateToBase: shape.rateToBase,
      rateSource: shape.rateSource,
      paidBy: Object.keys(shape.payers)[0]!,
      payers: shape.payers,
      split: shape.split,
      categoryId: e.categoryId,
    }, base, now),
  };
}

function transferDraft(
  t: PlannedTransfer,
  ids: Map<string, Id>,
  base: CurrencyCode,
  now: number,
  rateFor?: RateFor,
): OpDraft {
  return {
    entity: "settlement",
    entityId: newId(),
    kind: "create",
    patch: settlementCreatePatch({
      fromMember: ids.get(t.from)!,
      toMember: ids.get(t.to)!,
      ...shapeTransfer(t, base, rateFor),
      occurredAt: t.occurredAt,
      dateOnly: true,
      note: t.note,
    }, base, now),
  };
}
