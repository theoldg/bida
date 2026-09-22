import type { SealedOp } from "@bida/core";

/**
 * The D1 half of sync (docs/sync.md). The server appends and assigns seqs; it
 * never folds (ADR-0002) and can't, since ops are sealed (ADR-0036).
 */

interface GroupRow {
  id: string;
  token_hash: string;
  created_at: number;
  last_op_seq: number;
  /**
   * Set when deleted on request. The row stays so the id can't be registered
   * again — otherwise the next phone with the link pushes the log back.
   * `0003_group_tombstone.sql`.
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

/** A row that is a tombstone rather than a group: nothing may be read or written. */
export function isDeleted(group: GroupRow): boolean {
  return group.deleted_at !== null && group.deleted_at !== undefined;
}

/**
 * Delete one group: every op, and the group to a tombstone. The only
 * destructive path, and the only non-append in the app (ADR-0002): "delete my
 * data" can't be an entry in a log the server keeps. Authorised by the link's
 * token like everything else (ADR-0003).
 *
 * `last_op_seq` is left as is: a counter going backwards could hand a future
 * op a deleted op's seq.
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

/** First push for a group registers it — see docs/sync.md's "two endpoints". */
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
 * D1 binds at most 100 parameters per statement, so never build a clause from
 * the caller's array uncut. A phone back from weeks offline pushes its whole
 * queue at once; an uncut `IN (...)` fails every push past ~99 ops, retried
 * forever.
 *
 * Cut here, not refused with a 413: the server can't make old phones chunk,
 * and a refusal wedges exactly those clients.
 */
const IDS_PER_QUERY = 90;
const OPS_PER_BATCH = 100;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Accept sealed ops, idempotent on `SealedOp.id`: an op already stored keeps
 * its seq, so retrying after a dropped response is safe. A retry reseals under
 * a fresh IV, so the id — not the ciphertext — identifies it; the first stays.
 *
 * Reserving seqs and writing rows is **one** `db.batch` (one D1 transaction),
 * holding the invariant pulls rely on: every seq up to `last_op_seq` is a
 * readable row. As two statements, a pull between them got a `latestSeq`
 * covering missing rows, saved it as its cursor, and never saw those ops.
 *
 * Two pushes racing one op id collide on `ops.id` and fail whole; the retry
 * then finds the row, which is the idempotent path.
 */
export async function acceptOps(
  db: D1Database,
  groupId: string,
  ops: readonly SealedOp[],
  now: number,
): Promise<{ assigned: Record<string, number>; latestSeq: number }> {
  const assigned: Record<string, number> = {};
  if (ops.length === 0) {
    const group = await getGroup(db, groupId);
    return { assigned, latestSeq: group?.last_op_seq ?? 0 };
  }

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

  // One transaction per chunk: each reserves and writes together, and a run
  // leaves the log as smaller pushes would.
  let latestSeq = 0;
  for (const batch of chunk(fresh, OPS_PER_BATCH)) {
    // Reserve first, then each insert reads the counter back from the row just
    // moved (`last_op_seq - (n - 1 - i)` is op `i`'s seq); the subquery lets both
    // be bound in one batch.
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
