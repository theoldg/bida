// Doc: docs/sync.md#folding
import type { Table } from "dexie";
import { foldOps, type EntityKind, type GroupState } from "@bida/core";
import { started } from "../diag";
import { db, type StoredOp } from "./dexie";

/**
 * A row in one of the materialised tables. They all carry `id` and `groupId`;
 * `rates` and `identities` are the two whose primary key needs both, which is
 * why this is cast rather than typed per table (see dexie.ts).
 */
type Row = { id: string; groupId: string };

function tableFor(kind: EntityKind): Table<Row, string> {
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

/**
 * Each row carries `rev`: how many ops it is folded from, and the newest.
 * An entity's ops only ever grow, so a row whose ops moved has a new one and a
 * row nobody touched keeps its own through a rebuild — which is how the group's
 * read tells the few entries a save moved from the thousands it re-read
 * (`derive`, lib/derive.ts). Never content: `wholeEntity` leaves it out.
 */
function revs(ops: readonly StoredOp[]): Map<string, string> {
  const seen = new Map<string, { n: number; top: string }>();
  for (const op of ops) {
    const s = seen.get(op.entityId);
    if (!s) seen.set(op.entityId, { n: 1, top: op.hlc });
    else {
      s.n += 1;
      if (op.hlc > s.top) s.top = op.hlc;
    }
  }
  return new Map([...seen].map(([id, s]) => [id, `${s.n} ${s.top}`]));
}

function stamped<T extends { id: string }>(rows: Iterable<T>, rev: Map<string, string>): T[] {
  return Array.from(rows, (row) => ({ ...row, rev: rev.get(row.id) }));
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
 * The whole group as one folded state, from the log rather than the
 * materialised tables: invariant healers must read what the log means, not a
 * half-written cache. The same fold `rebuild` does on every pull.
 */
export async function groupState(groupId: string): Promise<GroupState> {
  return foldOps(await db().ops.where("groupId").equals(groupId).toArray());
}

/**
 * Re-fold one entity from its own ops and write the result. Safe because an
 * op only touches the entity it names; and one row written means a member
 * rename doesn't re-render the expense list.
 *
 * Scoped to the group too, for `rate`: its id is the currency code, so two
 * groups spending MAD share an entity id.
 */
export async function materialise(
  groupId: string, kind: EntityKind, entityId: string,
): Promise<void> {
  const ops = await db().ops.where("entityId").equals(entityId)
    .and((op) => op.groupId === groupId).toArray();
  if (ops.length === 0) return;
  const row = rowFor(kind, foldOps(ops), entityId);
  if (row) await tableFor(kind).put(stamped([row], revs(ops))[0]!);
}

/**
 * Throw away a group's materialised rows and fold the whole log again. Needed
 * when ops arrive out of order — folding an older op forward could let an
 * earlier write clobber a later one.
 */
export async function rebuild(groupId: string): Promise<void> {
  const d = db();
  // The readwrite lock here covers every table a screen reads, so a read that
  // arrives mid-rebuild waits for all of it. If a skeleton and one of these
  // lines overlap on the timeline, that is the whole answer (lib/diag.ts).
  const done = started("rebuild");
  let ops = 0;
  await d.transaction(
    "rw",
    [d.ops, d.groups, d.members, d.expenses, d.settlements, d.attachments, d.identities, d.rates],
    async () => {
      const rows = await d.ops.where("groupId").equals(groupId).toArray();
      ops = rows.length;
      const state = foldOps(rows);

      await Promise.all([
        d.members.where("groupId").equals(groupId).delete(),
        d.expenses.where("groupId").equals(groupId).delete(),
        d.settlements.where("groupId").equals(groupId).delete(),
        d.attachments.where("groupId").equals(groupId).delete(),
        d.identities.where("groupId").equals(groupId).delete(),
        d.rates.where("groupId").equals(groupId).delete(),
      ]);

      const rev = revs(rows);
      if (state.group) await d.groups.put(stamped([state.group], rev)[0]!);
      await d.members.bulkPut(stamped(Object.values(state.members), rev));
      await d.expenses.bulkPut(stamped(Object.values(state.expenses), rev));
      await d.settlements.bulkPut(stamped(Object.values(state.settlements), rev));
      await d.attachments.bulkPut(stamped(Object.values(state.attachments), rev));
      await d.identities.bulkPut(stamped(Object.values(state.identities), rev));
      await d.rates.bulkPut(stamped(Object.values(state.rates), rev));
    },
  );
  done(`${ops} ops`);
}

/** Every op for a group, for history and for the sync push. */
export async function opsForGroup(groupId: string): Promise<StoredOp[]> {
  return db().ops.where("groupId").equals(groupId).toArray();
}
