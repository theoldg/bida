import { healDrafts, type OpDraft } from "./invariants.js";
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
