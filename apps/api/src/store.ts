// Doc: docs/sync.md
import { chunk, type SealedOp } from "@bida/core";

export interface GroupRow {
  id: string;
  token_hash: string;
  created_at: number;
  last_op_seq: number;
  /**
   * The row stays so the id can't be registered again — otherwise the next phone
   * with the link pushes the log back.
   */
  deleted_at: number | null;
}

interface OpRow {
  seq: number;
  id: string;
  group_id: string;
  sealed: string;
}

function rowToOp(row: OpRow): SealedOp {
  return { id: row.id, groupId: row.group_id, sealed: row.sealed, seq: row.seq };
}

export async function getGroup(db: D1Database, groupId: string): Promise<GroupRow | null> {
  return db.prepare("SELECT * FROM groups WHERE id = ?").bind(groupId).first<GroupRow>();
}

export function isDeleted(group: GroupRow): boolean {
  return group.deleted_at !== null && group.deleted_at !== undefined;
}

/**
 * The only non-append in the app (ADR-0002). `last_op_seq` is left as is: a
 * counter going backwards could hand a future op a deleted op's seq.
 */
export async function deleteGroup(
  db: D1Database, groupId: string, now: number,
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM ops WHERE group_id = ?").bind(groupId),
    db.prepare("UPDATE groups SET token_hash = ?, deleted_at = ? WHERE id = ?")
      .bind("", now, groupId),
  ]);
}

export async function ensureGroup(
  db: D1Database,
  groupId: string,
  tokenHash: string,
  now: number,
): Promise<GroupRow> {
  const existing = await getGroup(db, groupId);
  if (existing) return existing;
  await db
    .prepare("INSERT INTO groups (id, token_hash, created_at, last_op_seq) VALUES (?, ?, ?, 0)")
    .bind(groupId, tokenHash, now)
    .run();
  return {
    id: groupId, token_hash: tokenHash, created_at: now, last_op_seq: 0, deleted_at: null,
  };
}

export async function opsSince(
  db: D1Database, groupId: string, since: number,
): Promise<SealedOp[]> {
  const { results } = await db
    .prepare("SELECT seq, id, group_id, sealed FROM ops WHERE group_id = ? AND seq > ? ORDER BY seq ASC")
    .bind(groupId, since)
    .all<OpRow>();
  return results.map(rowToOp);
}

/**
 * D1 binds at most 100 parameters per statement, and the server can't make old
 * phones chunk — so cut here rather than refuse.
 */
const IDS_PER_QUERY = 90;
const OPS_PER_BATCH = 100;

/**
 * Seqs and rows are one `db.batch`, holding what pulls rely on: every seq up to
 * `last_op_seq` is a readable row. A retry reseals under a fresh IV, so the id,
 * not the ciphertext, identifies an op.
 */
export async function acceptOps(
  db: D1Database,
  groupId: string,
  ops: readonly SealedOp[],
  now: number,
): Promise<{ assigned: Record<string, number>; latestSeq: number }> {
  const assigned: Record<string, number> = {};

  const existingSeqById = new Map<string, number>();
  for (const ids of chunk(ops.map((op) => op.id), IDS_PER_QUERY)) {
    const placeholders = ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT id, seq FROM ops WHERE group_id = ? AND id IN (${placeholders})`)
      .bind(groupId, ...ids)
      .all<{ id: string; seq: number }>();
    for (const row of results) existingSeqById.set(row.id, row.seq);
  }

  const fresh = ops.filter((op) => !existingSeqById.has(op.id));
  for (const [id, seq] of existingSeqById) assigned[id] = seq;

  if (fresh.length === 0) {
    const group = await getGroup(db, groupId);
    return { assigned, latestSeq: group?.last_op_seq ?? 0 };
  }

  let latestSeq = 0;
  for (const batch of chunk(fresh, OPS_PER_BATCH)) {
    // Each insert reads the counter back from the row just moved, so both bind in
    // one batch.
    const statements = [
      db
        .prepare(
          "UPDATE groups SET last_op_seq = last_op_seq + ? WHERE id = ? RETURNING last_op_seq",
        )
        .bind(batch.length, groupId),
      ...batch.map((op, i) =>
        db
          .prepare(
            "INSERT INTO ops (seq, id, group_id, sealed, received_at)"
            + " VALUES ((SELECT last_op_seq FROM groups WHERE id = ?) - ?, ?, ?, ?, ?)",
          )
          .bind(groupId, batch.length - 1 - i, op.id, groupId, op.sealed, now)),
    ];
    const results = await db.batch<{ last_op_seq: number }>(statements);
    latestSeq = results[0]?.results?.[0]?.last_op_seq ?? 0;
    if (latestSeq === 0) {
      throw new Error(`acceptOps: no sequence number came back for group ${groupId}`);
    }
    const firstSeq = latestSeq - batch.length + 1;
    batch.forEach((op, i) => { assigned[op.id] = firstSeq + i; });
  }

  return { assigned, latestSeq };
}
