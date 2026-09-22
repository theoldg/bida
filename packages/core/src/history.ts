import { compareHlc } from "./hlc.js";
import { IMMUTABLE_FIELDS, WRITE_ONCE_FIELDS, type Op } from "./ops.js";
import { applyPatch, sortOps } from "./fold.js";
import type { Id } from "./types.js";

/**
 * Version history is the op log, so it can't drift from the data (ADR-0002).
 * **A revision is a diff of two folds, never the stored patch**: `running` is
 * folded with the real `applyPatch`, so a whole-entity write still reads as
 * "changed the amount".
 */

interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
  /**
   * A later op overwrote this field — "replaced later", not provably concurrent,
   * which HLC can't show.
   */
  supersededByOpId?: Id;
}

export interface Revision {
  op: Op;
  entityId: Id;
  entity: Op["entity"];
  changes: FieldChange[];
  /**
   * The whole entity either side of this op, so a sentence can name fields the
   * op didn't move (the currency, income or not, the other payer).
   */
  before: Readonly<Record<string, unknown>>;
  after: Readonly<Record<string, unknown>>;
  isCreate: boolean;
  isDelete: boolean;
}

function equalish(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Absent and `null` both mean unset: a create omits unset fields, so an edit
  // sending `null` isn't a change and mustn't read as "changed the category".
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
      // Diff the folds; a whole-entity patch names every field and moves almost none.
      applyPatch(running, op.patch);
      for (const field of Object.keys(op.patch)) {
        if (IMMUTABLE_FIELDS.has(field)) continue;
        // The fold ignores it on an entity that already has one.
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
