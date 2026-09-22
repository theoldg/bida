import {
  canonicalSplit, colorSeedFor, memberIdFor, newGroupId, newGroupSecret, newId, primaryPayer,
  type Id, type ImportPlan, type OpDraft, type PlannedEntry, type PlannedTransfer,
} from "@bida/core";
import { appendOps } from "./append";
import { saveGroupKey } from "./groups";
import { only } from "./patch";
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
  /** Which of the file's people is holding this phone. Must be one of `plan.members`. */
  myName: string;
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
      },
    },
    // Everyone the file had a column for, all as current members: the shape
    // has no way to say someone left.
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
    ...plan.entries.map((e) => expenseDraft(e, ids, plan.currency, now)),
    ...plan.transfers.map((t) => transferDraft(t, ids, plan.currency, now)),
  ];

  await appendOps(groupId, me, drafts, now);
  await setMe(groupId, me);
  return { groupId, memberId: me, secret };
}

/**
 * One row as an expense op. `rateToBase` is `"1"`: the file is single-currency
 * in the group's base (mixed files are refused upstream).
 *
 * The split is `exact` — the file hands over amounts, and `equal` would be a
 * claim about the original a re-export could contradict by a cent.
 */
function expenseDraft(
  e: PlannedEntry,
  ids: Map<string, Id>,
  currency: string,
  now: number,
): OpDraft {
  const amounts: Record<Id, number> = {};
  for (const [name, minor] of Object.entries(e.owed)) amounts[ids.get(name)!] = minor;

  const payers: Record<Id, number> = {};
  for (const [name, minor] of Object.entries(e.paid)) payers[ids.get(name)!] = minor;
  const payerIds = Object.keys(payers);
  // A single payer is stored as `paidBy` alone, the way `normalisePayers` does
  // it: the common case never carries a redundant field, and the overwhelming
  // majority of imported rows are that case.
  const single = payerIds.length === 1;

  return {
    entity: "expense",
    entityId: newId(),
    kind: "create",
    patch: {
      ...(e.kind === "income" ? { kind: "income" } : {}),
      description: e.description,
      occurredAt: e.occurredAt,
      // The row's own day, not the day it was imported: the ledger is the
      // trip, and `createdAt` below is where "this arrived today" lives.
      dateOnly: true,
      createdAt: now,
      amountMinor: e.amountMinor,
      currency,
      rateToBase: "1",
      baseAmountMinor: e.amountMinor,
      paidBy: single ? payerIds[0]! : primaryPayer(payers, payerIds[0]!),
      split: canonicalSplit({ mode: "exact", amounts }),
      ...only({
        categoryId: e.categoryId,
        payers: single ? null : payers,
      }),
    },
  };
}

function transferDraft(
  t: PlannedTransfer,
  ids: Map<string, Id>,
  currency: string,
  now: number,
): OpDraft {
  return {
    entity: "settlement",
    entityId: newId(),
    kind: "create",
    patch: {
      fromMember: ids.get(t.from)!,
      toMember: ids.get(t.to)!,
      amountMinor: t.amountMinor,
      currency,
      rateToBase: "1",
      baseAmountMinor: t.amountMinor,
      occurredAt: t.occurredAt,
      dateOnly: true,
      createdAt: now,
      ...only({ note: t.note }),
    },
  };
}
