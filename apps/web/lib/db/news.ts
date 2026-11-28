// Doc: docs/history.md#the-clock-and-its-dot

import { CATCH_UP_MS, unseenRevisions } from "@bida/core";
import { getDevice } from "./device";
import { db } from "./dexie";
import { opsForGroup } from "./fold";

/**
 * How many revisions other phones made that this one hasn't seen — the
 * ledger's dot, the groups list's count, and whether a group's notification
 * still stands, so the three can't disagree.
 */
export async function newsCount(
  groupId: string, key?: { seenSeq?: number; lastSeq: number },
): Promise<number> {
  key ??= await db().groupKeys.get(groupId);
  // No key is the demo; no mark is a group whose first pull hasn't landed.
  if (key?.seenSeq === undefined || key.lastSeq <= key.seenSeq) return 0;
  const [ops, device] = await Promise.all([opsForGroup(groupId), getDevice()]);
  return unseenRevisions(ops, key.seenSeq, device.nodeId, Date.now() - CATCH_UP_MS).revisions.length;
}

/** Device-local, so no op. Only forward: a screen leaving with a stale count mustn't bring old edits back. */
export async function markSeen(groupId: string, seq: number): Promise<boolean> {
  const d = db();
  return d.transaction("rw", d.groupKeys, async () => {
    const key = await d.groupKeys.get(groupId);
    if (!key || seq <= (key.seenSeq ?? 0)) return false;
    await d.groupKeys.update(groupId, { seenSeq: seq });
    return true;
  });
}

/**
 * A new look at the ledger: **what the last one showed is seen now**. Resolves
 * once the mark has moved, so a dot read after it is this look's.
 */
export async function beginLook(groupId: string): Promise<boolean> {
  const key = await db().groupKeys.get(groupId);
  return key?.shownSeq !== undefined && markSeen(groupId, key.shownSeq);
}

/** The ledger is on screen at `lastSeq`. Not mid-join: a join's pages are its past, not news. */
export async function recordShown(groupId: string, lastSeq: number): Promise<void> {
  const d = db();
  await d.transaction("rw", d.groupKeys, async () => {
    const key = await d.groupKeys.get(groupId);
    if (!key || key.seenSeq === undefined || lastSeq <= (key.shownSeq ?? 0)) return;
    await d.groupKeys.update(groupId, { shownSeq: Math.min(lastSeq, key.lastSeq) });
  });
}
