"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { CATCH_UP_MS, unseenRevisions } from "@bida/core";
import { Icon } from "@/components/icons";
import { copy } from "@/lib/copy";
import { markEditsSeen } from "@/lib/db/commands";
import { getDevice } from "@/lib/db/device";
import { db } from "@/lib/db/dexie";
import { opsForGroup } from "@/lib/db/fold";
import { useLive } from "@/lib/db/live";
import { route } from "@/lib/group-link";

/**
 * The ledger's way to its history, and the one place it says what changed on
 * other phones since this one last showed it: a dot on the clock.
 *
 * **New** is `unseenRevisions` (core/history.ts), which the groups list counts
 * too. **Showing it is seeing it**: the dot holds for as long as the ledger is
 * open, and leaving the ledger marks all of it seen — the catch-up is
 * optional, so it is offered once and not again. Going by the clock carries
 * the mark from before (`route.history`'s `since`), so history can draw its
 * line under what was new even though leaving here moved the mark. What waits
 * on a group nobody opens ages out after `CATCH_UP_MS`.
 */
export function HistoryButton({ groupId }: { groupId: string }) {
  const fresh = useLive("newEdits", async () => {
    const key = await db().groupKeys.get(groupId);
    // No key is the demo; no mark is a group whose first pull hasn't landed.
    if (key?.seenSeq === undefined) return null;
    const { revisions, through } = unseenRevisions(await opsForGroup(groupId),
      key.seenSeq, (await getDevice()).nodeId, Date.now() - CATCH_UP_MS);
    return { seen: key.seenSeq, through, count: revisions.length };
  }, [groupId]);

  // Leaving the ledger — history, an entry, the groups list — marks all of it
  // seen: the dot was on screen. Read through a ref: the cleanup outlives the
  // render.
  const leave = useRef(0);
  leave.current = fresh?.through ?? 0;
  useEffect(() => () => {
    if (leave.current > 0) void markEditsSeen(groupId, leave.current);
  }, [groupId]);

  const news = (fresh?.count ?? 0) > 0;
  return (
    <Link className="iconbtn histbtn" href={route.history(groupId, undefined, undefined, news ? fresh?.seen : undefined)}
      aria-label={news ? copy.group.historyNew : copy.group.history}>
      <Icon name="clock" size={18} />
      {news ? <span className="histdot" aria-hidden="true" /> : null}
    </Link>
  );
}
