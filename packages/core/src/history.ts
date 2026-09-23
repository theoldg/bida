import { compareHlc, parseHlc } from "./hlc.js";
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

/**
 * Fields that are plumbing, not news: a device subscribing to notifications
 * moves nobody's money or name, so a revision that moved only these is dropped.
 */
const QUIET_FIELDS: Partial<Record<Op["entity"], ReadonlySet<string>>> = {
  identity: new Set(["push"]),
};

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
    const quiet = QUIET_FIELDS[op.entity];

    if (isDelete) {
      changes.push({ field: "deletedAt", before: running["deletedAt"] ?? null, after: op.createdAt });
      running["deletedAt"] = op.createdAt;
    } else {
      // Diff the folds; a whole-entity patch names every field and moves almost none.
      applyPatch(running, op.patch);
      for (const field of Object.keys(op.patch)) {
        if (IMMUTABLE_FIELDS.has(field) || quiet?.has(field)) continue;
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

const nodeOf = (hlc: string): string | undefined => {
  try { return parseHlc(hlc).node; } catch { return undefined; }
};

/** How long a change waits in the catch-up for someone to unfold it. */
export const CATCH_UP_MS = 7 * 86_400_000;

/**
 * What changed on other phones since this one last showed it: revisions of ops
 * the server numbered past `seenSeq` whose stamp is another node's — your own
 * laptop included — newest first. The ledger's line and the groups list both
 * count from this, so they can't disagree.
 *
 * Not news: a device claiming a name (plumbing, not the group's money), and a
 * change stamped before `notBefore` — the catch-up is optional, so what nobody
 * unfolds ages out rather than waiting on the groups list for good.
 *
 * `through` is the highest seq in the log, this node's and quiet ones included:
 * what unfolding the result may mark seen. `settled` stops short of the oldest
 * change still unseen: what merely opening the group may mark, so this node's
 * own ops don't hold the mark back while nothing unread is skipped.
 */
export function unseenRevisions(
  ops: readonly Op[], seenSeq: number, node: string, notBefore = 0,
): { revisions: Revision[]; through: number; settled: number } {
  let through = seenSeq;
  const news = new Set<Id>();
  for (const op of ops) {
    const seq = op.seq ?? 0;
    if (seq > through) through = seq;
    if (seq > seenSeq && op.entity !== "identity" && op.createdAt >= notBefore
      && nodeOf(op.hlc) !== node) news.add(op.id);
  }
  if (news.size === 0) return { revisions: [], through, settled: through };
  // A revision's diff needs its entity's earlier ops, so the feed is folded
  // over every op of the touched entities, then cut down to the new ones.
  const touched = new Set(ops.filter((o) => news.has(o.id)).map((o) => o.entityId));
  const revisions = activityFeed(ops.filter((o) => touched.has(o.entityId)))
    .filter((r) => news.has(r.op.id));
  const settled = revisions.length === 0 ? through
    : Math.min(...revisions.map((r) => r.op.seq ?? 0)) - 1;
  return { revisions, through, settled };
}
