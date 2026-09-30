import { groupCrypto } from "../seal";

/**
 * The pull a notification's arrival makes ahead of the app (docs/sync.md#the-pull-ahead).
 * `public/sw.js` reads a group's cursor, pulls with it when a push for the group
 * lands and leaves the answer — sealed, as the server sent it — for the page
 * to apply before it draws the group. Cache Storage, not Dexie, so the worker
 * needs no bundle and never holds a lock on the database.
 *
 * **Every part of it may be wrong in the one direction that is today's
 * behaviour**: an old cursor pulls more than it needs, a lost stash leaves the
 * op to the ordinary pull, and applying a stash never moves `lastSeq`, so the
 * pull after it fetches the same ops again and cannot skip any. The names are
 * `sw.js`'s too: change them together.
 */
export const STASH_CACHE = "bida-pull";
const cursorKey = (groupId: string) => `/pull/${encodeURIComponent(groupId)}/cursor`;
export const stashKey = (groupId: string) => `/pull/${encodeURIComponent(groupId)}/ops`;

/** What the worker needs to pull a group: the bearer, never the link secret. */
interface Cursor {
  token: string;
  since: number;
}

export function stashes(): Promise<Cache> | undefined {
  return typeof caches === "undefined" ? undefined : caches.open(STASH_CACHE);
}

/** The cursor last written per group, so a sync that moved nothing writes nothing. */
const leftCursors = new Map<string, string>();

export async function leaveCursor(groupId: string, secret: string, since: number): Promise<void> {
  const cache = await stashes();
  if (!cache) return;
  const cursor: Cursor = { token: (await groupCrypto(groupId, secret)).token, since };
  const body = JSON.stringify(cursor);
  if (leftCursors.get(groupId) === body) return;
  await cache.put(cursorKey(groupId), new Response(body, { headers: { "Content-Type": "application/json" } }));
  leftCursors.set(groupId, body);
}

/** Both of a group's entries, when the group leaves this phone. */
export async function dropStash(groupId: string): Promise<void> {
  leftCursors.delete(groupId);
  const cache = await stashes();
  if (!cache) return;
  await Promise.all([cache.delete(cursorKey(groupId)), cache.delete(stashKey(groupId))]);
}
