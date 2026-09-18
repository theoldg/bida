import type { SealedOp } from "@bida/core";

/**
 * The D1-backed half of the sync protocol (docs/sync.md). The server appends
 * and assigns sequence numbers; it never folds ops into entities — that stays
 * client-only (ADR-0002) — and since ADR-0036 it cannot, because every op
 * arrives sealed and the key is derived from a secret it never receives.
 */

interface GroupRow {
  id: string;
  token_hash: string;
  created_at: number;
  last_op_seq: number;
  /**
   * Set when the group was deleted on request (`DELETE /api/groups/:id`, from
   * `/delete-my-data`). The row stays so the id cannot be registered again:
   * without it, the next phone still holding the link would push its local log
   * back and the deletion would undo itself. `0003_group_tombstone.sql`.
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
 * Delete one group: every op, and the group itself down to a tombstone.
 *
 * The only destructive path in the API, and the only one in the app that is not
 * an appended op (ADR-0002) — because "delete my data" cannot be answered with
 * an entry in a log the server still holds. It is authorised the way everything
 * else is, by the token derived from the link secret: whoever holds the link is
 * the group, so whoever holds the link can end it (ADR-0003).
 *
 * `last_op_seq` is deliberately left where it was. Nothing may be written to
 * this id again, and a counter that went backwards would be the one thing that
 * could hand a future op the sequence number of a deleted one.
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
 * Accept a batch of sealed ops. Idempotent on `SealedOp.id`: an op already in
 * the log keeps its original seq instead of being reassigned or duplicated,
 * which is what makes retrying a push after a dropped response safe. A retry
 * seals the same op under a fresh IV, so the two ciphertexts differ — the id is
 * what says they are one op, and the first one stored is the one that stays.
 *
 * Reserving the sequence numbers and writing the rows is **one** `db.batch`,
 * which D1 runs as a single transaction. That is what holds the invariant the
 * pulling phone depends on: every seq up to `last_op_seq` is a row it can
 * already read. Two statements could not hold it — a phone syncing between the
 * reserve and the insert was answered with a `latestSeq` covering rows that
 * were not there yet, wrote it down as its cursor, and never asked for that
 * range again. The ops were not lost on the server; they were lost to that
 * phone, silently and for good.
 *
 * Two pushes racing the same op id now collide on `ops.id` and take the whole
 * batch down rather than half-writing it. The push fails, the phone retries,
 * and the retry finds the row already there — which is the idempotent path.
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

  // The reserve first, then one insert per op reading the counter back out of
  // the row it just moved: `last_op_seq - (n - 1 - i)` is op `i`'s number. The
  // subquery is what lets the insert be bound before the reserve has run, and
  // so lets both live in the one batch.
  const statements = [
    db
      .prepare("UPDATE groups SET last_op_seq = last_op_seq + ? WHERE id = ? RETURNING last_op_seq")
      .bind(fresh.length, groupId),
    ...fresh.map((op, i) =>
      db
        .prepare(
          "INSERT INTO ops (seq, id, group_id, sealed, received_at)"
          + " VALUES ((SELECT last_op_seq FROM groups WHERE id = ?) - ?, ?, ?, ?, ?)",
        )
        .bind(groupId, fresh.length - 1 - i, op.id, groupId, op.sealed, now)),
  ];
  const results = await db.batch<{ last_op_seq: number }>(statements);
  const latestSeq = results[0]?.results?.[0]?.last_op_seq;
  if (latestSeq === undefined) {
    throw new Error(`acceptOps: no sequence number came back for group ${groupId}`);
  }

  const firstSeq = latestSeq - fresh.length + 1;
  fresh.forEach((op, i) => { assigned[op.id] = firstSeq + i; });

  return { assigned, latestSeq };
}
