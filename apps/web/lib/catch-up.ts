"use client";
// Doc: docs/history.md#the-clock-and-its-dot

import { useEffect, useState } from "react";
import { CATCH_UP_MS, unseenRevisions, type Op } from "@bida/core";
import { markEditsSeen } from "@/lib/db/commands";
import { getDevice } from "@/lib/db/device";
import { db } from "@/lib/db/dexie";
import { useLive } from "@/lib/db/live";
import { beginLook, recordShown } from "@/lib/db/news";
import { closeSeen } from "@/lib/tray";

/**
 * Where a group's history last stood before it was opened: the seen mark from
 * before, per group, in memory. Opening history moves the mark at once, so
 * this is how its torn line survives a trip into an entry and back. The
 * ledger and the groups list end it (`endCatchUp`): from either, the next
 * opening of history is a new look.
 */
const since = new Map<string, { seq: number; node: string }>();

export function endCatchUp(groupId?: string): void {
  if (groupId === undefined) {
    since.clear();
    looks.clear();
  } else since.delete(groupId);
}

/**
 * Groups whose ledger is being looked at, each with its look's number. A look
 * begins when the ledger is drawn with none going — from the groups list, at
 * launch, back from the background — and lasts through its entries and
 * history. **What one look showed, the next counts as seen** (`beginLook`):
 * the dot, the groups list's count and the tray clear on the second opening.
 */
const looks = new Map<string, Look>();
interface Look { n: number; ready: Promise<unknown>; done: boolean }
let looked = 0;
let watching = false;

function lookAt(groupId: string): Look {
  const going = looks.get(groupId);
  if (going) return going;
  const look: Look = { n: ++looked, done: false, ready: Promise.resolve() };
  look.ready = beginLook(groupId).catch(() => false).then((moved) => {
    look.done = true;
    if (moved) void closeSeen(groupId);
  });
  looks.set(groupId, look);
  return look;
}

/**
 * This look's number once its mark has moved, for the ledger's dot to read
 * after; `undefined` before. The cursor is recorded as shown while the ledger
 * is on screen, landing pulls included.
 */
export function useLedgerLook(groupId: string): number | undefined {
  const [look, setLook] = useState(() => {
    const going = looks.get(groupId);
    return going?.done ? going.n : undefined;
  });
  useEffect(() => {
    if (!watching) {
      watching = true;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") looks.clear();
      });
    }
    let live = true;
    const begin = () => {
      if (document.visibilityState !== "visible") return;
      const going = lookAt(groupId);
      void going.ready.then(() => { if (live && looks.get(groupId) === going) setLook(going.n); });
    };
    begin();
    document.addEventListener("visibilitychange", begin);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", begin);
    };
  }, [groupId]);

  // `null`, never `undefined`, for the keyless demo (docs/live-reads.md).
  const cursor = useLive("ledgerCursor", async () => (await db().groupKeys.get(groupId))?.lastSeq ?? null,
    [groupId]);
  useEffect(() => {
    if (look !== undefined && typeof cursor === "number" && looks.get(groupId)?.n === look) {
      void recordShown(groupId, cursor);
    }
  }, [groupId, look, cursor]);
  return look;
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
