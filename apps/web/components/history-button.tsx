"use client";
// Doc: docs/history.md#the-clock-and-its-dot

import Link from "next/link";
import { useEffect } from "react";
import { CATCH_UP_MS, unseenRevisions } from "@bida/core";
import { Icon } from "@/components/icons";
import { endCatchUp } from "@/lib/catch-up";
import { copy } from "@/lib/copy";
import { getDevice } from "@/lib/db/device";
import { db } from "@/lib/db/dexie";
import { opsForGroup } from "@/lib/db/fold";
import { useLive } from "@/lib/db/live";
import { route } from "@/lib/group-link";

/**
 * The ledger's way to its history, and the one place it says what changed on
 * other phones since this one last looked: a dot on the clock.
 *
 * **New** is `unseenRevisions` (core/history.ts), which the groups list counts
 * too. The dot stays until history is opened — opening it is seeing it
 * (`useCatchUp`, lib/catch-up.ts) — or the change ages out after
 * `CATCH_UP_MS`. Being back on the ledger ends the last look at history, so
 * the next one draws its torn line afresh.
 */
export function HistoryButton({ groupId }: { groupId: string }) {
  const news = useLive("newEdits", async () => {
    const key = await db().groupKeys.get(groupId);
    // No key is the demo; no mark is a group whose first pull hasn't landed.
    if (key?.seenSeq === undefined || key.lastSeq <= key.seenSeq) return false;
    return unseenRevisions(await opsForGroup(groupId), key.seenSeq,
      (await getDevice()).nodeId, Date.now() - CATCH_UP_MS).revisions.length > 0;
  }, [groupId]);

  useEffect(() => endCatchUp(groupId), [groupId]);

  return (
    <Link className="iconbtn histbtn" href={route.history(groupId)}
      aria-label={news ? copy.group.historyNew : copy.group.history}>
      <Icon name="clock" size={18} />
      {news ? <span className="histdot" aria-hidden="true" /> : null}
    </Link>
  );
}
