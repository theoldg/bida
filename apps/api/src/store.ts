import type { Op } from "@bida/core";

/**
 * The D1-backed half of the sync protocol (docs/sync.md). The server appends
 * and assigns sequence numbers; it never folds ops into entities — that stays
 * client-only (ADR-0002).
 */

interface GroupRow {
  id: string;
  secret_hash: string;
  created_at: number;
  last_op_seq: number;
}

interface OpRow {
  seq: number;
  id: string;
  group_id: string;
  entity: string;
  entity_id: string;
  kind: string;
  patch: string;
  hlc: string;
  actor: string;
  note: string | null;
  created_at: number;
}

function rowToOp(row: OpRow): Op {
  return {
    id: row.id,
    groupId: row.group_id,
    entity: row.entity as Op["entity"],
    entityId: row.entity_id,
    kind: row.kind as Op["kind"],
    patch: JSON.parse(row.patch) as Record<string, unknown>,
    hlc: row.hlc,
    actor: row.actor,
    note: row.note,
    createdAt: row.created_at,
    seq: row.seq,
  };
}

export async function getGroup(db: D1Database, groupId: string): Promise<GroupRow | null> {
  return db.prepare("SELECT * FROM groups WHERE id = ?").bind(groupId).first<GroupRow>();
}

/** First push for a group registers it — see docs/sync.md's "two endpoints". */
export async function ensureGroup(
  db: D1Database,
  groupId: string,
  secretHash: string,
  now: number,
): Promise<GroupRow> {
  const existing = await getGroup(db, groupId);
  if (existing) return existing;
  await db
    .prepare("INSERT INTO groups (id, secret_hash, created_at, last_op_seq) VALUES (?, ?, ?, 0)")
    .bind(groupId, secretHash, now)
    .run();
  return { id: groupId, secret_hash: secretHash, created_at: now, last_op_seq: 0 };
}

export async function opsSince(db: D1Database, groupId: string, since: number): Promise<Op[]> {
  const { results } = await db
    .prepare("SELECT * FROM ops WHERE group_id = ? AND seq > ? ORDER BY seq ASC")
    .bind(groupId, since)
    .all<OpRow>();
  return results.map(rowToOp);
}

/**
 * Accept a batch of unsynced ops. Idempotent on `Op.id`: an op already in the
 * log keeps its original seq instead of being reassigned or duplicated, which
 * is what makes retrying a push after a dropped response safe.
 *
 * Not fully race-proof against two concurrent pushes to the *same* group
 * racing the seq counter — acceptable at this app's scale (a handful of
 * phones, human-paced writes); see docs/sync.md#gotchas.
 */
export async function acceptOps(
  db: D1Database,
  groupId: string,
  ops: readonly Op[],
): Promise<{ assigned: Record<string, number>; latestSeq: number }> {
  const assigned: Record<string, number> = {};
  if (ops.length === 0) {
    const group = await getGroup(db, groupId);
    return { assigned, latestSeq: group?.last_op_seq ?? 0 };
  }

  const ids = ops.map((op) => op.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results: existingRows } = await db
    .prepare(`SELECT id, seq FROM ops WHERE group_id = ? AND id IN (${placeholders})`)
    .bind(groupId, ...ids)
    .all<{ id: string; seq: number }>();
  const existingSeqById = new Map(existingRows.map((r) => [r.id, r.seq]));

  const fresh = ops.filter((op) => !existingSeqById.has(op.id));
  for (const [id, seq] of existingSeqById) assigned[id] = seq;

  if (fresh.length === 0) {
    const group = await getGroup(db, groupId);
    return { assigned, latestSeq: group?.last_op_seq ?? 0 };
  }

  const reserved = await db
    .prepare("UPDATE groups SET last_op_seq = last_op_seq + ? WHERE id = ? RETURNING last_op_seq")
    .bind(fresh.length, groupId)
    .first<{ last_op_seq: number }>();
  const latestSeq = reserved?.last_op_seq ?? fresh.length;
  const firstSeq = latestSeq - fresh.length + 1;

  const inserts = fresh.map((op, i) => {
    const seq = firstSeq + i;
    assigned[op.id] = seq;
    return db
      .prepare(
        `INSERT INTO ops (seq, id, group_id, entity, entity_id, kind, patch, hlc, actor, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        seq,
        op.id,
        groupId,
        op.entity,
        op.entityId,
        op.kind,
        JSON.stringify(op.patch),
        op.hlc,
        op.actor,
        op.note ?? null,
        op.createdAt,
      );
  });
  await db.batch(inserts);

  return { assigned, latestSeq };
}
