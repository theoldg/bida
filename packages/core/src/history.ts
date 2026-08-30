import { compareHlc } from "./hlc.js";
import { IMMUTABLE_FIELDS, type Op } from "./ops.js";
import { sortOps } from "./fold.js";
import type { Id } from "./types.js";

/**
 * Version history falls straight out of the op log — no extra storage, and it
 * cannot drift from the data, because it IS the data. See ADR-0002.
 */

export interface FieldChange {
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
  isCreate: boolean;
  isDelete: boolean;
}

function equalish(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
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

    if (isDelete) {
      changes.push({ field: "deletedAt", before: running["deletedAt"] ?? null, after: op.createdAt });
      running["deletedAt"] = op.createdAt;
    } else {
      for (const [field, after] of Object.entries(op.patch)) {
        if (IMMUTABLE_FIELDS.has(field)) continue;
        const before = running[field];
        if (equalish(before, after)) continue;
        changes.push({ field, before: before ?? null, after });
        running[field] = after;
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
