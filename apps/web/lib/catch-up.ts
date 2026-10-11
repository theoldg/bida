"use client";

import { useEffect, useState } from "react";
import { CATCH_UP_MS, unseenRevisions, type Op } from "@bida/core";
import { markEditsSeen } from "@/lib/db/commands";
import { getDevice } from "@/lib/db/device";
import { db } from "@/lib/db/dexie";

/**
 * Where a group's history last stood before it was opened: the seen mark from
 * before, per group, in memory. Opening history moves the mark at once, so
 * this is how its torn line survives a trip into an entry and back. The
 * ledger and the groups list end it (`endCatchUp`): from either, the next
 * opening of history is a new look.
 */
const since = new Map<string, { seq: number; node: string }>();

export function endCatchUp(groupId?: string): void {
  if (groupId === undefined) since.clear();
  else since.delete(groupId);
}

/**
 * The op ids history draws above its torn line: what changed on other phones
 * past the mark held from when this look began (`unseenRevisions`, which the
 * ledger's dot and the groups list count too). **Opening history is seeing
 * it**: the mark moves past all of it, and past whatever lands while history
 * is open. `undefined` until the mark is read; empty when nothing is new.
 */
export function useCatchUp(groupId: string | undefined, ops: readonly Op[] | undefined): ReadonlySet<string> | undefined {
  const [from, setFrom] = useState(() => (groupId ? since.get(groupId) : undefined));
  useEffect(() => {
    if (!groupId || from) return;
    let live = true;
    void (async () => {
      const [key, device] = await Promise.all([db().groupKeys.get(groupId), getDevice()]);
      // No key is the demo; no mark is a group whose first pull hasn't landed.
      // Either way nothing is new, so it is a look with an empty line.
      const held = since.get(groupId) ?? { seq: key?.seenSeq ?? Infinity, node: device.nodeId };
      since.set(groupId, held);
      if (live) setFrom(held);
    })();
    return () => { live = false; };
  }, [groupId, from]);

  const { revisions, through } = from && ops
    ? unseenRevisions(ops, from.seq, from.node, Date.now() - CATCH_UP_MS)
    : { revisions: [], through: 0 };
  useEffect(() => {
    if (groupId && Number.isFinite(through) && through > 0) void markEditsSeen(groupId, through);
  }, [groupId, through]);

  return from && ops ? new Set(revisions.map((r) => r.op.id)) : undefined;
}
