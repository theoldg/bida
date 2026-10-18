// Doc: docs/history.md
import { compareHlc, parseHlc } from "./hlc";
import type { Op } from "./ops";
import { applyPatch, sortOps } from "./fold";
import { isDemo } from "./demo";
import type { Id } from "./types";

/**
 * Version history is the op log, so it can't drift from the data (ADR-0002). **A
 * revision is a diff of two folds, never the stored patch**: a whole-entity write
 * still reads as "changed the amount".
 */

interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
  /** "Replaced later", not provably concurrent, which HLC can't show. */
  supersededByOpId?: Id;
}

export interface Revision {
  op: Op;
  entityId: Id;
  entity: Op["entity"];
  changes: FieldChange[];
  /** So a sentence can name fields the op didn't move. */
  before: Readonly<Record<string, unknown>>;
  after: Readonly<Record<string, unknown>>;
  isCreate: boolean;
  isDelete: boolean;
  /** The moment is the import's, not the entry's. */
  imported: boolean;
  /** So "everyone" means everyone *then*, not whoever has joined since. */
  roster: readonly Id[];
}

export function groupCreateOf(ops: readonly Op[]): Op | undefined {
  let first: Op | undefined;
  for (const op of ops) {
    if (op.entity === "group" && op.kind === "create"
      && (!first || compareHlc(op.hlc, first.hlc) < 0)) first = op;
  }
  return first;
}

/**
 * An entry sharing the group's create — actor, device, wall-clock moment — came
 * from the source. Read off the log rather than a flag, so older imports read the
 * same. The demo is seeded the same way and is not an import.
 */
export function isImported(op: Op, groupCreate: Op | undefined): boolean {
  return !!groupCreate && op.kind === "create"
    && (op.entity === "expense" || op.entity === "settlement")
    && op.actor === groupCreate.actor && op.createdAt === groupCreate.createdAt
    && nodeOf(op.hlc) === nodeOf(groupCreate.hlc) && !isDemo(op.groupId);
}

/** Plumbing, not news: a revision that moved only these is dropped. */
const QUIET_FIELDS: Partial<Record<Op["entity"], ReadonlySet<string>>> = {
  identity: new Set(["push"]),
};

/** An op that moves only plumbing: no revision, and no activity on the groups list. */
export function isQuiet(op: Pick<Op, "entity" | "kind" | "patch">): boolean {
  const quiet = QUIET_FIELDS[op.entity];
  return !!quiet && op.kind === "update" && Object.keys(op.patch).every((field) => quiet.has(field));
}

function equalish(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // A create omits unset fields, so an edit sending `null` isn't a change.
  if ((a ?? null) === null || (b ?? null) === null) return (a ?? null) === (b ?? null);
  if (typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function revisionsForEntity(
  ops: readonly Op[], entityId: Id, groupCreate: Op | undefined, rosterAt: (hlc: string) => readonly Id[],
): Revision[] {
  const sorted = sortOps(ops);
  const running: Record<string, unknown> = {};
  const revisions: Revision[] = [];
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
      applyPatch(running, op.patch, op.hlc);
      for (const field of Object.keys(op.patch)) {
        // The fold ignored an immutable or set write-once field, so the diff
        // finds nothing.
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

export function entityHistory(ops: readonly Op[], entityId: Id): Revision[] {
  const mine = ops.filter((o) => o.entityId === entityId);
  return revisionsForEntity(mine, entityId, groupCreateOf(ops), rosterOf(ops)).reverse();
}

export function activityFeed(ops: readonly Op[], limit?: number): Revision[] {
  const all = feedOf(ops, groupCreateOf(ops), rosterOf(ops));
  return limit === undefined ? all : all.slice(0, limit);
}

/** Folded once into a timeline, since a feed asks once per revision. */
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

export const CATCH_UP_MS = 7 * 86_400_000;

/**
 * Revisions of ops numbered past `seenSeq` stamped by another node — your own
 * laptop included. The ledger and the groups list both count from this, so they
 * can't disagree. Before `notBefore` ages out rather than sitting there for good.
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
  // A revision's diff needs its entity's earlier ops, so fold all, then cut down.
  const touched = new Set(ops.filter((o) => news.has(o.id)).map((o) => o.entityId));
  const revisions = feedOf(ops.filter((o) => touched.has(o.entityId)), groupCreateOf(ops), rosterOf(ops))
    .filter((r) => news.has(r.op.id));
  return { revisions, through };
}
