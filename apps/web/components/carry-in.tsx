"use client";
// Doc: docs/ios.md#the-in-app-browser--a-one-off-visit

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { claimIdentity, saveGroupKey } from "../lib/db/commands";
import { getDevice } from "../lib/db/device";
import { db } from "../lib/db/dexie";
import { syncGroup } from "../lib/db/sync";
import { keepNote } from "../lib/diag";
import { markLaunched } from "../lib/first-frame";
import { formatJoinLink, route, type CarriedGroup } from "../lib/group-link";
import { handOverToGroup, launchPlan, launchedOnto } from "../lib/launch";

/**
 * Groups carried in from another storage, and who that one was in each, taken
 * as `launchPlan` (lib/launch.ts) says: an iOS icon's launch onto `/install`,
 * or an in-app browser's way out onto `/handover`. A member it had named is
 * claimed before sync — this is a device of its own — since the claim is an
 * op riding the next push.
 *
 * A launch reopens the last group, and a spent fragment is still a launch, so
 * **`lib/launch.ts` answers it, not this hook**. A `handover` instead lands in
 * the group it was opened from, the first carried.
 *
 * **Nothing here un-forgets**: `saveGroupKey` would undo a `forgetGroup`, and
 * a forgotten group's key is erased, so `leftGroups` is what says no.
 *
 * **`location.replace`, not the router**, for the hand-off to `/join`: Next's
 * router drops the fragment when it falls back to a full load
 * (docs/ios.md#gotchas).
 */
export function useCarryIn(invites: CarriedGroup[] | undefined, { handover = false } = {}): void {
  const router = useRouter();
  useEffect(() => {
    if (!invites) return;
    let cancelled = false;
    void (async () => {
      const [keys, device] = await Promise.all([db().groupKeys.toArray(), getDevice()]);
      const held = new Set(keys.map((key) => key.groupId));
      const plan = launchPlan(invites, held, new Set(device.leftGroups ?? []), device.meByGroup);
      if (cancelled) return;
      keepNote(handover ? "install.handover" : "install.app", `${invites.length} groups, `
        + `${invites.filter((i) => i.me).length} named; ${held.size} keys held → ${plan.kind === "save"
          ? `save ${plan.fresh.length} fresh, claim ${plan.naming.length}` : plan.kind}`);
      // Before leaving, whichever way: no later launch of this icon is a first join.
      if (!handover) markLaunched();
      if (plan.kind === "join") { location.replace(formatJoinLink(plan.invite)); return; }
      if (plan.kind === "save") {
        for (const invite of plan.fresh) await saveGroupKey(invite.groupId, invite.secret);
        for (const invite of plan.naming) await claimIdentity(invite.groupId, invite.me!);
        // Best-effort: `StartSync`'s loop retries every group anyway, and the
        // list fills from the live query as each one lands.
        for (const invite of [...plan.fresh, ...plan.naming]) syncGroup(invite.groupId).catch(() => {});
      }
      if (cancelled) return;
      const first = invites[0];
      if (handover && first) handOverToGroup(first.groupId);
      else launchedOnto();
      router.replace(route.groups());
    })();
    return () => { cancelled = true; };
  }, [invites, handover, router]);
}
