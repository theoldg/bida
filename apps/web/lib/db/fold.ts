import type { Table } from "dexie";
import { foldOps, type EntityKind } from "@hajsik/core";
import { db, type StoredOp } from "./dexie";

/** A row in one of the materialised tables. They all key on `id`. */
type Row = { id: string };

export function tableFor(kind: EntityKind): Table<Row, string> {
  const d = db();
  const t =
    kind === "group" ? d.groups
    : kind === "member" ? d.members
    : kind === "expense" ? d.expenses
    : kind === "settlement" ? d.settlements
    : kind === "identity" ? d.identities
    : d.attachments;
  return t as unknown as Table<Row, string>;
}

function rowFor(kind: EntityKind, state: ReturnType<typeof foldOps>, id: string): Row | undefined {
  const bag =
    kind === "group" ? (state.group ? { [state.group.id]: state.group } : {})
    : kind === "member" ? state.members
    : kind === "expense" ? state.expenses
    : kind === "settlement" ? state.settlements
    : kind === "identity" ? state.identities
    : state.attachments;
  return bag[id] as Row | undefined;
}

/**
 * Re-fold one entity from its own ops and write the result.
 *
 * Entity-scoped is safe because merging is per-field within one entity: an op
 * never affects another entity's fields. It also means a write touches one row,
 * so a live query over the expense list doesn't re-render on a member rename.
 */
export async function materialise(kind: EntityKind, entityId: string): Promise<void> {
  const ops = await db().ops.where("entityId").equals(entityId).toArray();
  if (ops.length === 0) return;
  const row = rowFor(kind, foldOps(ops), entityId);
  if (row) await tableFor(kind).put(row);
}

/**
 * Throw away every materialised row for a group and fold the whole log again.
 *
 * Needed whenever ops arrive out of order — a sync pull carrying an op older
 * than something already applied can't be folded forward without risking a
 * later write being clobbered by an earlier one.
 */
export async function rebuild(groupId: string): Promise<void> {
  const d = db();
  await d.transaction(
    "rw",
    [d.ops, d.groups, d.members, d.expenses, d.settlements, d.attachments, d.identities],
    async () => {
      const ops = await d.ops.where("groupId").equals(groupId).toArray();
      const state = foldOps(ops);

      await Promise.all([
        d.members.where("groupId").equals(groupId).delete(),
        d.expenses.where("groupId").equals(groupId).delete(),
        d.settlements.where("groupId").equals(groupId).delete(),
        d.attachments.where("groupId").equals(groupId).delete(),
        d.identities.where("groupId").equals(groupId).delete(),
      ]);

      if (state.group) await d.groups.put(state.group);
      await d.members.bulkPut(Object.values(state.members));
      await d.expenses.bulkPut(Object.values(state.expenses));
      await d.settlements.bulkPut(Object.values(state.settlements));
      await d.attachments.bulkPut(Object.values(state.attachments));
      await d.identities.bulkPut(Object.values(state.identities));
    },
  );
}

/** Every op for a group, for history and for the sync push. */
export async function opsForGroup(groupId: string): Promise<StoredOp[]> {
  return db().ops.where("groupId").equals(groupId).toArray();
}
