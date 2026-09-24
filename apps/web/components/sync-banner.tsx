"use client";

import { Banner } from "@/components/chrome";
import { copy } from "@/lib/copy";
import { plural } from "@/lib/format";
import { useOnline, useSyncHealth } from "@/lib/hooks";

/**
 * Three ways to be out of step, most urgent last: offline (benign), a server
 * that won't answer, a refused key (never heals by itself). No colour — that
 * is for balances (ADR-0023). Over the ledger and the balances, the two
 * screens whose figures a stale copy would get wrong.
 */
export function SyncBanner({ groupId, pendingOps }: { groupId: string; pendingOps: number }) {
  const online = useOnline();
  const sync = useSyncHealth(groupId);
  if (!online) {
    return (
      <Banner icon="off">
        {pendingOps > 0
          ? copy.group.offlinePending(plural(pendingOps, copy.noun.change))
          : copy.group.offlineIdle}
      </Banner>
    );
  }
  if (sync.rejected) return <Banner icon="sync">{copy.group.rejected}</Banner>;
  if (sync.failing) {
    return (
      <Banner icon="sync">
        {pendingOps > 0
          ? copy.group.unreachablePending(plural(pendingOps, copy.noun.change))
          : copy.group.unreachableIdle}
      </Banner>
    );
  }
  return null;
}
