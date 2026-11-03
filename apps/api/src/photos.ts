// Doc: docs/photos.md
import { chunk } from "@bida/core";

/**
 * Kept receipt photos: sealed bytes in R2, an index and a budget in D1. The
 * Worker never reads a photo (ADR-0036); it only refuses to store more than
 * the free tier covers.
 *
 * R2 bills the account past 10 GB stored, 1M writes or 10M reads a month, and
 * dev and production share those, so each environment gets its own share,
 * checked here before the bucket is touched. Reads are not counted: the free
 * Workers plan stops at 100k requests a day, a read is one request, and a
 * month of those is ~3.1M — under the 10M before anyone counts. Deletes are
 * free, and listing (a paid write) is never needed: the index knows the keys.
 */

export interface PhotoBudget {
  /** Sealed bytes held at once. */
  stored: number;
  /** Uploads per calendar month, UTC. */
  writes: number;
}

/** Together under the free tier's 10 GB and 1M, with room for the counters to be wrong. */
export const PHOTO_BUDGETS: Record<"production" | "dev", PhotoBudget> = {
  production: { stored: 8_000_000_000, writes: 800_000 },
  dev: { stored: 1_000_000_000, writes: 100_000 },
};

/**
 * One group's share: ~600 kept bills at the ~150 KB a kept photo seals to,
 * years of a household's weekly shop. Past it a photo stays on the phone that
 * took it, so one link can't spend everybody's room.
 */
export const GROUP_PHOTO_BYTES = 100_000_000;

/** `newId()`'s shape: nothing else may name an object. */
export function isPhotoId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
}

export function photoKey(groupId: string, id: string): string {
  return `${groupId}/${id}`;
}

function monthKey(now: number): string {
  return `writes:${new Date(now).toISOString().slice(0, 7)}`;
}

export type Reservation = "reserved" | "held" | "group full" | "storage full" | "month spent";

/**
 * Books a photo's bytes and its write before the upload, or says why not.
 * Each counter moves only if it stays under its ceiling, in one statement, so
 * two uploads racing can't both take the last room. "held" is a second upload
 * of a photo already stored: the phone retried, and nothing is spent.
 */
export async function reservePhoto(
  db: D1Database, groupId: string, id: string, bytes: number, budget: PhotoBudget, now: number,
): Promise<Reservation> {
  const held = await db.prepare("SELECT bytes FROM photos WHERE group_id = ? AND id = ?")
    .bind(groupId, id).first<{ bytes: number }>();
  if (held) return "held";

  const group = await db.prepare("SELECT COALESCE(SUM(bytes), 0) AS total FROM photos WHERE group_id = ?")
    .bind(groupId).first<{ total: number }>();
  if ((group?.total ?? 0) + bytes > GROUP_PHOTO_BYTES) return "group full";

  const stored = await db.prepare(`
    INSERT INTO photo_usage (key, value) SELECT 'stored', ?1 WHERE ?1 <= ?2
    ON CONFLICT(key) DO UPDATE SET value = value + ?1 WHERE value + ?1 <= ?2
    RETURNING value
  `).bind(bytes, budget.stored).first<{ value: number }>();
  if (!stored) return "storage full";

  const wrote = await db.prepare(`
    INSERT INTO photo_usage (key, value) SELECT ?1, 1 WHERE 1 <= ?2
    ON CONFLICT(key) DO UPDATE SET value = value + 1 WHERE value < ?2
    RETURNING value
  `).bind(monthKey(now), budget.writes).first<{ value: number }>();
  if (!wrote) {
    await giveBack(db, bytes);
    return "month spent";
  }
  return "reserved";
}

/**
 * The upload landed: index it. A twin upload that raced this one indexed it
 * first, so this one's booking is handed back — the object is the same key.
 */
export async function commitPhoto(
  db: D1Database, groupId: string, id: string, bytes: number, now: number,
): Promise<void> {
  const row = await db.prepare(`
    INSERT INTO photos (group_id, id, bytes, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(group_id, id) DO NOTHING RETURNING id
  `).bind(groupId, id, bytes, now).first<{ id: string }>();
  if (!row) await giveBack(db, bytes);
}

/** A booking whose upload failed, or a photo gone: the bytes, never the write. */
export async function giveBack(db: D1Database, bytes: number): Promise<void> {
  await db.prepare("UPDATE photo_usage SET value = MAX(0, value - ?) WHERE key = 'stored'")
    .bind(bytes).run();
}

/** The object first: an index row without an object costs nothing, the reverse costs room. */
export async function deletePhoto(
  db: D1Database, bucket: R2Bucket, groupId: string, id: string,
): Promise<void> {
  await bucket.delete(photoKey(groupId, id));
  const row = await db.prepare("DELETE FROM photos WHERE group_id = ? AND id = ? RETURNING bytes")
    .bind(groupId, id).first<{ bytes: number }>();
  if (row) await giveBack(db, row.bytes);
}

/** R2 deletes at most a thousand keys a call. */
const DELETE_KEYS = 1000;

/** Every photo of a deleted group, found by the index rather than a paid list. */
export async function deleteGroupPhotos(
  db: D1Database, bucket: R2Bucket | undefined, groupId: string,
): Promise<void> {
  const { results } = await db.prepare("SELECT id, bytes FROM photos WHERE group_id = ?")
    .bind(groupId).all<{ id: string; bytes: number }>();
  // Without the bucket the index is all that knows where the bytes are.
  if (results.length === 0 || !bucket) return;
  for (const keys of chunk(results.map((r) => photoKey(groupId, r.id)), DELETE_KEYS)) {
    await bucket.delete(keys);
  }
  await db.batch([
    db.prepare("DELETE FROM photos WHERE group_id = ?").bind(groupId),
    db.prepare("UPDATE photo_usage SET value = MAX(0, value - ?) WHERE key = 'stored'")
      .bind(results.reduce((sum, r) => sum + r.bytes, 0)),
  ]);
}
