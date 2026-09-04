import type { Table } from "dexie";
import { foldOps, type EntityKind } from "@hajsik/core";
import { db, type StoredOp } from "./dexie";

/**
 * A row in one of the materialised tables. They all carry `id` and `groupId`;
 * `rates` and `identities` are the two whose primary key needs both, which is
 * why this is cast rather than typed per table (see dexie.ts).
 */
type Row = { id: string; groupId: string };

export function tableFor(kind: EntityKind): Table<Row, string> {
  const d = db();
  const t =
    kind === "group" ? d.groups
    : kind === "member" ? d.members
    : kind === "expense" ? d.expenses
    : kind === "settlement" ? d.settlements
    : kind === "identity" ? d.identities
    : kind === "rate" ? d.rates
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
    : kind === "rate" ? state.rates
    : state.attachments;
  return bag[id] as Row | undefined;
}

/**
 * Re-fold one entity from its own ops and write the result.
 *
 * Entity-scoped is safe because merging is per-field within one entity: an op
 * never affects another entity's fields. It also means a write touches one row,
 * so a live query over the expense list doesn't re-render on a member rename.
 *
 * Scoped to the group as well as the entity, which matters for exactly one
 * entity: a `rate`'s id is its currency code, so two groups on this phone both
 * spending in MAD have ops under the same entity id. Every other entity has a
 * random id and the filter costs it nothing.
 */
export async function materialise(
  groupId: string, kind: EntityKind, entityId: string,
): Promise<void> {
  const ops = await db().ops.where("entityId").equals(entityId)
    .and((op) => op.groupId === groupId).toArray();
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
    [d.ops, d.groups, d.members, d.expenses, d.settlements, d.attachments, d.identities, d.rates],
    async () => {
      const ops = await d.ops.where("groupId").equals(groupId).toArray();
      const state = foldOps(ops);

      await Promise.all([
        d.members.where("groupId").equals(groupId).delete(),
        d.expenses.where("groupId").equals(groupId).delete(),
        d.settlements.where("groupId").equals(groupId).delete(),
        d.attachments.where("groupId").equals(groupId).delete(),
        d.identities.where("groupId").equals(groupId).delete(),
        d.rates.where("groupId").equals(groupId).delete(),
      ]);

      if (state.group) await d.groups.put(state.group);
      await d.members.bulkPut(Object.values(state.members));
      await d.expenses.bulkPut(Object.values(state.expenses));
      await d.settlements.bulkPut(Object.values(state.settlements));
      await d.attachments.bulkPut(Object.values(state.attachments));
      await d.identities.bulkPut(Object.values(state.identities));
      await d.rates.bulkPut(Object.values(state.rates));
    },
  );
}

/** Every op for a group, for history and for the sync push. */
export async function opsForGroup(groupId: string): Promise<StoredOp[]> {
  return db().ops.where("groupId").equals(groupId).toArray();
}
