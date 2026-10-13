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
    db.prepare("DELETE FROM op_batches WHERE group_id = ?").bind(groupId),
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

/** What one pull hands back: everything in `(since, upTo]`, and whether the log goes on. */
export interface Page {
  ops: SealedOp[];
  upTo: number;
  more: boolean;
}

/**
 * At most this many seqs, and about this many characters of seal, per answer:
 * the free plan's 10 ms of CPU per request, and a phone's patience on a slow
 * link, are what a join of a ten-thousand-op group spent in one.
 */
export const PAGE_OPS = 500;
export const PAGE_CHARS = 512_000;

/** A row of `op_batches` holds at most this many ops, and about this many characters. */
export const BATCH_OPS = 200;
export const BATCH_CHARS = 1_000_000;

interface BatchRow {
  last_seq: number;
  ids: string;
  sealed: string;
}

function batchOps(groupId: string, row: BatchRow): SealedOp[] {
  const ids = JSON.parse(row.ids) as string[];
  const sealed = JSON.parse(row.sealed) as string[];
  const first = row.last_seq - ids.length + 1;
  return ids.map((id, i) => ({ id, groupId, sealed: sealed[i]!, seq: first + i }));
}

/**
 * The ops after `since`, from both tables, cut to a page. `head` is the group's
 * `last_op_seq` read before this: every seq up to it has its row, so a page
 * that reaches it is the whole log, and anything committed since is left to
 * the next pull rather than handed out past the cursor.
 */
export async function pullPage(
  db: D1Database, groupId: string, since: number, head: number,
): Promise<Page> {
  const end = Math.min(since + PAGE_OPS, head);
  if (end <= since) return { ops: [], upTo: Math.max(since, head), more: false };
  const [legacy, batches] = await Promise.all([
    db.prepare("SELECT seq, id, group_id, sealed FROM ops WHERE group_id = ? AND seq > ? AND seq <= ? ORDER BY seq")
      .bind(groupId, since, end)
      .all<OpRow>(),
    // A row reaching past `end` still holds seqs inside it.
    db.prepare("SELECT last_seq, ids, sealed FROM op_batches WHERE group_id = ? AND last_seq > ? AND last_seq < ? ORDER BY last_seq")
      .bind(groupId, since, end + BATCH_OPS)
      .all<BatchRow>(),
  ]);
  const all = [
    ...legacy.results.map(rowToOp),
    ...batches.results.flatMap((row) => batchOps(groupId, row)),
  ].filter((op) => op.seq! > since && op.seq! <= end)
    .sort((a, b) => a.seq! - b.seq!);

  const ops: SealedOp[] = [];
  let chars = 0;
  for (const op of all) {
    if (ops.length > 0 && chars + op.sealed.length > PAGE_CHARS) break;
    ops.push(op);
    chars += op.sealed.length;
  }
  const upTo = ops.length < all.length ? ops[ops.length - 1]!.seq! : end;
  return { ops, upTo, more: upTo < head };
}

/**
 * D1 binds at most 100 parameters per statement, and the server can't make old
 * phones chunk — so cut here rather than refuse.
 */
const IDS_PER_QUERY = 90;

/**
 * The seqs already given to any of `ids`. A retry's first answer never reached
 * the phone, so its cursor is still at or before those seqs: the rows past
 * `since` are all a retry can be in. `ops` is looked up by id, as it always was.
 */
async function alreadyHeld(
  db: D1Database, groupId: string, ids: readonly string[], since: number,
): Promise<Map<string, number>> {
  const held = new Map<string, number>();
  const wanted = new Set(ids);
  for (const slice of chunk(ids, IDS_PER_QUERY)) {
    const placeholders = slice.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT id, seq FROM ops WHERE group_id = ? AND id IN (${placeholders})`)
      .bind(groupId, ...slice)
      .all<{ id: string; seq: number }>();
    for (const row of results) held.set(row.id, row.seq);
  }
  const { results } = await db
    .prepare("SELECT last_seq, ids FROM op_batches WHERE group_id = ? AND last_seq > ?")
    .bind(groupId, since)
    .all<{ last_seq: number; ids: string }>();
  for (const row of results) {
    const rowIds = JSON.parse(row.ids) as string[];
    const first = row.last_seq - rowIds.length + 1;
    rowIds.forEach((id, i) => { if (wanted.has(id) && !held.has(id)) held.set(id, first + i); });
  }
  return held;
}

/** Runs of `ops` that each fit one `op_batches` row. */
function batchesOf(ops: readonly SealedOp[]): SealedOp[][] {
  const out: SealedOp[][] = [];
  let run: SealedOp[] = [];
  let chars = 0;
  for (const op of ops) {
    if (run.length > 0 && (run.length >= BATCH_OPS || chars + op.sealed.length > BATCH_CHARS)) {
      out.push(run);
      run = [];
      chars = 0;
    }
    run.push(op);
    chars += op.sealed.length;
  }
  if (run.length > 0) out.push(run);
  return out;
}

/**
 * One `db.batch`, so one transaction, holding what pulls rely on: every seq up
 * to `last_op_seq` is a readable row. A retry reseals under a fresh IV, so the
 * id, not the ciphertext, identifies an op.
 */
export async function acceptOps(
  db: D1Database,
  groupId: string,
  ops: readonly SealedOp[],
  since: number,
  now: number,
): Promise<{ assigned: Record<string, number>; latestSeq: number }> {
  const assigned: Record<string, number> = {};
  if (ops.length === 0) {
    return { assigned, latestSeq: (await getGroup(db, groupId))?.last_op_seq ?? 0 };
  }

  const held = await alreadyHeld(db, groupId, ops.map((op) => op.id), since);
  for (const [id, seq] of held) assigned[id] = seq;
  const seen = new Set(held.keys());
  const fresh = ops.filter((op) => !seen.has(op.id) && seen.add(op.id));

  if (fresh.length === 0) {
    return { assigned, latestSeq: (await getGroup(db, groupId))?.last_op_seq ?? 0 };
  }

  const rows = batchesOf(fresh);
  // Each insert reads the counter back from the row just moved, so both bind in
  // one batch.
  const statements = rows.flatMap((row) => [
    db.prepare("UPDATE groups SET last_op_seq = last_op_seq + ? WHERE id = ? RETURNING last_op_seq")
      .bind(row.length, groupId),
    db.prepare(
      "INSERT INTO op_batches (group_id, last_seq, ids, sealed, received_at)"
      + " VALUES (?, (SELECT last_op_seq FROM groups WHERE id = ?), ?, ?, ?)",
    ).bind(
      groupId, groupId,
      JSON.stringify(row.map((op) => op.id)), JSON.stringify(row.map((op) => op.sealed)), now,
    ),
  ]);
  const results = await db.batch<{ last_op_seq: number }>(statements);

  let latestSeq = 0;
  rows.forEach((row, k) => {
    latestSeq = results[2 * k]?.results?.[0]?.last_op_seq ?? 0;
    if (latestSeq === 0) {
      throw new Error(`acceptOps: no sequence number came back for group ${groupId}`);
    }
    const firstSeq = latestSeq - row.length + 1;
    row.forEach((op, i) => { assigned[op.id] = firstSeq + i; });
  });

  return { assigned, latestSeq };
}
