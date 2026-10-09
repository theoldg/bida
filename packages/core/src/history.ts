import { compareHlc, parseHlc } from "./hlc.js";
import type { Op } from "./ops.js";
import { applyPatch, sortOps } from "./fold.js";
import { isDemo } from "./demo.js";
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
  /**
   * An entry's create that came in with the group: written in the group's own
   * first batch (`isImported`). Whoever imported it is its actor, and the
   * moment is the import's, not the entry's.
   */
  imported: boolean;
  /**
   * Who was in the group as this op landed — created and not removed — so a
   * sentence can say "everyone" or "everyone but Cy" about *then*, not about
   * whoever has joined since.
   */
  roster: readonly Id[];
}

/** The op that made the group, where `ops` holds it: the earliest create. */
export function groupCreateOf(ops: readonly Op[]): Op | undefined {
  let first: Op | undefined;
  for (const op of ops) {
    if (op.entity === "group" && op.kind === "create"
      && (!first || compareHlc(op.hlc, first.hlc) < 0)) first = op;
  }
  return first;
}

/**
 * Was this entry create written by an import? A group made by hand is created
 * holding people and no entries; one made from a file or a tricount is written
 * in one batch with every entry in it (`importGroup`), so an entry sharing the
 * group's create — its actor, its device, its wall-clock moment — came from
 * the source. Read off the log rather than a flag, so groups imported before
 * anybody asked read the same. The demo is seeded the same way and is not
 * an import.
 */
export function isImported(op: Op, groupCreate: Op | undefined): boolean {
  return !!groupCreate && op.kind === "create"
    && (op.entity === "expense" || op.entity === "settlement")
    && op.actor === groupCreate.actor && op.createdAt === groupCreate.createdAt
    && nodeOf(op.hlc) === nodeOf(groupCreate.hlc) && !isDemo(op.groupId);
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
function revisionsForEntity(
  ops: readonly Op[], entityId: Id, groupCreate: Op | undefined, rosterAt: (hlc: string) => readonly Id[],
): Revision[] {
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
        // An immutable or already-set write-once field needs no check of its
        // own: the fold ignored it, so the diff below finds nothing.
        if (quiet?.has(field)) continue;
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
      imported: isImported(op, groupCreate),
      roster: rosterAt(op.hlc),
    });
  }

  return revisions;
}

/** History for one expense (or any entity), newest first. */
export function entityHistory(ops: readonly Op[], entityId: Id): Revision[] {
  const mine = ops.filter((o) => o.entityId === entityId);
  return revisionsForEntity(mine, entityId, groupCreateOf(ops), rosterOf(ops)).reverse();
}

/** The whole group's activity, newest first. */
export function activityFeed(ops: readonly Op[], limit?: number): Revision[] {
  const all = feedOf(ops, groupCreateOf(ops), rosterOf(ops));
  return limit === undefined ? all : all.slice(0, limit);
}

/**
 * Who was in the group at a moment, read off the member ops up to it. Folded
 * once into a timeline of who-is-in after each member op, then looked up by
 * stamp, since a feed asks once per revision.
 */
export function rosterOf(ops: readonly Op[]): (hlc: string) => readonly Id[] {
  const timeline: { hlc: string; roster: readonly Id[] }[] = [];
  const alive = new Map<Id, boolean>();
  for (const op of sortOps(ops.filter((o) => o.entity === "member"))) {
    const lift = op.patch["deletedAt"];
    if (op.kind === "delete") alive.set(op.entityId, false);
    else if (op.kind === "restore" || (op.kind === "update" && "deletedAt" in op.patch)) {
      alive.set(op.entityId, lift === null || lift === undefined);
    } else if (op.kind === "create" && !alive.has(op.entityId)) alive.set(op.entityId, true);
    else continue;
    timeline.push({ hlc: op.hlc, roster: [...alive].filter(([, on]) => on).map(([id]) => id) });
  }
  return (hlc) => {
    // The last member op at or before `hlc`; a feed is short, members few.
    let lo = 0;
    let hi = timeline.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compareHlc(timeline[mid]!.hlc, hlc) <= 0) lo = mid + 1;
      else hi = mid;
    }
    return lo === 0 ? [] : timeline[lo - 1]!.roster;
  };
}

/** `activityFeed`, told the group's create — which `ops` may have been cut down past. */
function feedOf(
  ops: readonly Op[], groupCreate: Op | undefined, rosterAt: (hlc: string) => readonly Id[],
): Revision[] {
  const byEntity = new Map<Id, Op[]>();
  for (const op of ops) {
    const list = byEntity.get(op.entityId);
    if (list) list.push(op);
    else byEntity.set(op.entityId, [op]);
  }
  const all: Revision[] = [];
  for (const [entityId, entityOps] of byEntity) {
    all.push(...revisionsForEntity(entityOps, entityId, groupCreate, rosterAt));
  }
  return all.sort((a, b) => compareHlc(b.op.hlc, a.op.hlc));
}

const nodeOf = (hlc: string): string | undefined => {
  try { return parseHlc(hlc).node; } catch { return undefined; }
};

/** How long a change waits in the catch-up for someone to open its group. */
export const CATCH_UP_MS = 7 * 86_400_000;

/**
 * What changed on other phones since this one last showed it: revisions of ops
 * the server numbered past `seenSeq` whose stamp is another node's — your own
 * laptop included — newest first. The ledger's line and the groups list both
 * count from this, so they can't disagree.
 *
 * Not news: a device claiming a name (plumbing, not the group's money), and a
 * change stamped before `notBefore`, so what waits on a group nobody opens ages
 * out rather than sitting on the groups list for good.
 *
 * `through` is the highest seq in the log, this node's and quiet ones included:
 * what showing the result may mark seen.
 */
export function unseenRevisions(
  ops: readonly Op[], seenSeq: number, node: string, notBefore = 0,
): { revisions: Revision[]; through: number } {
  let through = seenSeq;
  const news = new Set<Id>();
  for (const op of ops) {
    const seq = op.seq ?? 0;
    if (seq > through) through = seq;
    if (seq > seenSeq && op.entity !== "identity" && op.createdAt >= notBefore
      && nodeOf(op.hlc) !== node) news.add(op.id);
  }
  if (news.size === 0) return { revisions: [], through };
  // A revision's diff needs its entity's earlier ops, so the feed is folded
  // over every op of the touched entities, then cut down to the new ones.
  const touched = new Set(ops.filter((o) => news.has(o.id)).map((o) => o.entityId));
  const revisions = feedOf(ops.filter((o) => touched.has(o.entityId)), groupCreateOf(ops), rosterOf(ops))
    .filter((r) => news.has(r.op.id));
  return { revisions, through };
}
