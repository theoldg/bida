import { sortOps } from "./fold.js";
import { healDrafts, type OpDraft } from "./invariants.js";
import type { Op } from "./ops.js";
import type { GroupState, Id } from "./types.js";

/**
 * Putting a deleted entry back: the whole entry, as it was when it was deleted
 * (ADR-0031). Nothing but the tombstone moves, so an edit made offline and a
 * restore both survive a merge — `deletedAt` merges per field (docs/sync.md).
 */

export type EntryEntity = "expense" | "settlement";

/**
 * The ops a restore writes: the entry's lift, then whatever the entry being
 * live again newly demands. The entry wins over a removal made since, just as
 * it does when a merge races one (`liveEntriesNameLiveMembers`), so the
 * people and the rate it names come back in the same append rather than on
 * the next sync. Repairs the group already owed are left to the sync's heal:
 * this command writes only what it causes.
 *
 * Empty for an entry that is live or unknown — pressing twice writes once.
 */
export function restoreEntryDrafts(state: GroupState, entity: EntryEntity, id: Id): OpDraft[] {
  const bucket = entity === "expense" ? state.expenses : state.settlements;
  const row = bucket[id];
  if (!row?.deletedAt) return [];
  const lifted: GroupState = entity === "expense"
    ? { ...state, expenses: { ...state.expenses, [id]: { ...state.expenses[id]!, deletedAt: null } } }
    : { ...state, settlements: { ...state.settlements, [id]: { ...state.settlements[id]!, deletedAt: null } } };
  const owed = new Set(healDrafts(state).map((d) => `${d.entity}/${d.entityId}`));
  return [
    { entity, entityId: id, kind: "update", patch: { deletedAt: null } },
    ...healDrafts(lifted).filter((d) => !owed.has(`${d.entity}/${d.entityId}`)),
  ];
}

/**
 * The live entry that took this one's place, if any. From 2026-09-20 to 09-24
 * saving an expense as a transfer (or back) deleted it and created the other
 * kind in one append (ADR-0010). Restoring that half while the other lives
 * would count the money twice, so the deleted screen links to it instead.
 *
 * Nothing marked those writes, so they are recognised by what one append
 * shares: the actor and the wall clock, to the millisecond.
 */
export function liveReplacement(
  ops: readonly Op[], state: GroupState, id: Id,
): { entity: EntryEntity; id: Id } | undefined {
  const del = sortOps(ops).filter((o) => o.entityId === id && o.kind === "delete").at(-1);
  if (!del || (del.entity !== "expense" && del.entity !== "settlement")) return undefined;
  const other: EntryEntity = del.entity === "expense" ? "settlement" : "expense";
  const twin = ops.find((o) => o.entity === other && o.kind === "create"
    && o.actor === del.actor && o.createdAt === del.createdAt);
  if (!twin) return undefined;
  const row = (other === "expense" ? state.expenses : state.settlements)[twin.entityId];
  return row && !row.deletedAt ? { entity: other, id: twin.entityId } : undefined;
}
