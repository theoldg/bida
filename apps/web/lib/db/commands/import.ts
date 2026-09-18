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
 * **One batch, one HLC run**, the way `createGroup` writes a group with its
 * people already in it: a hundred rows off a CSV are not a hundred things
 * somebody did a millisecond apart, and the history reads as an import rather
 * than as an afternoon of typing. It is also the only shape that is atomic —
 * a tab dying halfway through cannot leave half a ledger.
 *
 * **Nothing here is a new idea about sync.** Every row becomes an ordinary
 * `create` op under one actor, so there is no import op kind, nothing for the
 * merge rules to learn, and a second phone joining the link sees exactly what
 * it would see for a group typed in by hand.
 *
 * **Into a new group only.** Merging a file into a group that already has
 * entries means deciding which rows are the same entry as which, and the file
 * carries no ids to decide it with — so v1 does not offer it, and the entry
 * point is on the groups list rather than in a group's own menu.
 */

export interface ImportGroupInput {
  /** What to call it. The shape has nowhere to say, so the screen asks. */
  name: string;
  /** Which of the file's people is holding this phone. Must be one of `plan.members`. */
  myName: string;
}

/**
 * Names to member ids, the same derivation every other write uses.
 *
 * `memberIdFor` is a hash of the group id and the name, so two phones adding
 * "Ana" write the same entity — and here it means the ids are settled before
 * a single op is built, which is what lets the whole import be one batch.
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
    // Everyone the file had a column for, current members all: the shape gives
    // a departed member a plain column like anybody else, with nothing to say
    // they have left, so there is no way to bring that back and the screen
    // says so rather than guessing.
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
 * One row as an expense op.
 *
 * `rateToBase` is `"1"` and `baseAmountMinor` is the amount: the file is
 * single-currency and that currency is the group's base, so there is nothing
 * to convert and no registry to consult. A mixed-currency file is refused
 * upstream precisely because there would be.
 *
 * The split is `exact`. Every other mode is a rule for deriving amounts, and
 * what the file hands over is the amounts themselves — `equal` would be a
 * claim about the original that a re-export could contradict by a cent.
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
