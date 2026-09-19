import { compareHlc } from "./hlc.js";
import { IMMUTABLE_FIELDS, WRITE_ONCE_FIELDS, type Op } from "./ops.js";
import { applyPatch, sortOps } from "./fold.js";
import type { Id } from "./types.js";

/**
 * Version history falls straight out of the op log — no extra storage, and it
 * cannot drift from the data, because it IS the data. See ADR-0002.
 *
 * **A revision is a diff of two folds, never a reading of the stored patch.**
 * `running` is the entity folded up to and including each op, by the same
 * `applyPatch` the real fold uses; a change is a field that moved across it.
 * That is what lets an entry's content be written whole — the op says "here is
 * the whole expense" and the revision still reads "changed the amount".
 */

interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
  /**
   * A later op overwrote this field. Note this is "was replaced later", not
   * strictly "was concurrent" — HLC alone cannot prove concurrency, and for the
   * history UI "Marie later changed this" is the honest, useful statement.
   */
  supersededByOpId?: Id;
}

export interface Revision {
  op: Op;
  entityId: Id;
  entity: Op["entity"];
  changes: FieldChange[];
  /**
   * The whole entity either side of this op — every field, not only the ones
   * that moved. `changes` says what the revision did; these say what it did it
   * *to*, which is what lets a sentence name a field the op never moved: the
   * currency a contribution is in, whether this is an income, who the other
   * payer was.
   */
  before: Readonly<Record<string, unknown>>;
  after: Readonly<Record<string, unknown>>;
  isCreate: boolean;
  isDelete: boolean;
}

function equalish(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // An absent field and an explicit `null` are the same value — not set. A
  // create leaves an unset field off entirely, so an edit sending `null` for it
  // is not a change anybody made; calling it one puts "changed the category" in
  // the log over edits that never touched one.
  if ((a ?? null) === null || (b ?? null) === null) return (a ?? null) === (b ?? null);
  if (typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Revisions for one entity, oldest first. */
function revisionsForEntity(ops: readonly Op[], entityId: Id): Revision[] {
  const sorted = sortOps(ops);
  const running: Record<string, unknown> = {};
  const revisions: Revision[] = [];
  /** field -> index into `revisions` of the last revision that wrote it. */
  const lastWriter = new Map<string, number>();

  for (const op of sorted) {
    const changes: FieldChange[] = [];
    const isDelete = op.kind === "delete";
    const before: Record<string, unknown> = { ...running };

    if (isDelete) {
      changes.push({ field: "deletedAt", before: running["deletedAt"] ?? null, after: op.createdAt });
      running["deletedAt"] = op.createdAt;
    } else {
      // Fold the op in, then diff the two states — never read the patch as
      // though its keys were the changes. A whole-entity write names every
      // field it holds and moves almost none of them.
      applyPatch(running, op.patch);
      for (const field of Object.keys(op.patch)) {
        if (IMMUTABLE_FIELDS.has(field)) continue;
        // Silently ignored by the fold on an entity that already has one, so
        // it is not a change anybody made and must not read as one.
        if (WRITE_ONCE_FIELDS.has(field) && before[field] !== undefined
          && before[field] !== null) continue;
        if (equalish(before[field], running[field])) continue;
        changes.push({ field, before: before[field] ?? null, after: running[field] });
      }
    }

    if (changes.length === 0 && op.kind !== "create") continue;

    const index = revisions.length;
    for (const change of changes) {
      const prior = lastWriter.get(change.field);
      if (prior !== undefined) {
        const priorChange = revisions[prior]!.changes.find((c) => c.field === change.field);
        if (priorChange) priorChange.supersededByOpId = op.id;
      }
      lastWriter.set(change.field, index);
    }

    revisions.push({
      op,
      entityId,
      entity: op.entity,
      changes,
      before,
      after: { ...running },
      isCreate: op.kind === "create",
      isDelete,
    });
  }

  return revisions;
}

/** History for one expense (or any entity), newest first. */
export function entityHistory(ops: readonly Op[], entityId: Id): Revision[] {
  const mine = ops.filter((o) => o.entityId === entityId);
  return revisionsForEntity(mine, entityId).reverse();
}

/** The whole group's activity, newest first. */
export function activityFeed(ops: readonly Op[], limit?: number): Revision[] {
  const byEntity = new Map<Id, Op[]>();
  for (const op of ops) {
    const list = byEntity.get(op.entityId);
    if (list) list.push(op);
    else byEntity.set(op.entityId, [op]);
  }
  const all: Revision[] = [];
  for (const [entityId, entityOps] of byEntity) {
    all.push(...revisionsForEntity(entityOps, entityId));
  }
  all.sort((a, b) => compareHlc(b.op.hlc, a.op.hlc));
  return limit === undefined ? all : all.slice(0, limit);
}
