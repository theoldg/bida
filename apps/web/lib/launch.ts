"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useState } from "react";
import type { Group } from "@bida/core";
import { getDevice, setLeftOnList } from "./db/device";
import { db, type DeviceRecord } from "./db/dexie";
import { route } from "./group-link";
import { clearFirstFrame } from "./first-frame";
import type { CarriedGroup } from "./group-link";

/**
 * Launching reopens the group you were last in — unless you backed out to the
 * list. **A launch, not every arrival at `/`**: back arrows go to the list, and
 * going back must not be turned around.
 */

/**
 * A launch from `/install`, the iOS icon's `start_url`, spent on the first
 * decision; otherwise the browser is asked (`isLaunch`), which a full load onto
 * the list answers the same way, so losing this costs nothing. **Nothing else is
 * handed to the list in memory**: a full load between two screens — the first
 * tap after a deploy is one — would drop it, so `/join` and `/handover` go
 * straight to the group by address instead.
 */
let launched = false;
let resumed = false;

export function launchedOnto(): void {
  launched = true;
}

/**
 * Not one this phone forgot, archived, or left for the list; the id stays for
 * `/new` and `/quick`'s currency.
 */
export function resumeGroupId(
  device: Pick<DeviceRecord, "lastOpenedGroupId" | "leftGroups" | "leftOnList"> | undefined,
  group: Pick<Group, "id" | "archivedAt"> | undefined,
): string | undefined {
  const id = device?.lastOpenedGroupId;
  if (!id || device?.leftOnList) return undefined;
  if (!group || group.id !== id) return undefined;
  if (device?.leftGroups?.includes(id) || group.archivedAt) return undefined;
  return id;
}

export function useResumeLastGroup(): { deciding: boolean } {
  const router = useRouter();
  // Read rather than spent in the initialiser, which React may run twice.
  const [deciding, setDeciding] = useState(() => launched || isLaunch());

  useEffect(() => {
    if (!deciding) return;
    launched = false;
    resumed = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    void (async () => {
      const device = await getDevice();
      const last = device.lastOpenedGroupId;
      const group = last ? await db().groups.get(last) : undefined;
      if (cancelled) return;
      const id = resumeGroupId(device, group);
      if (!id) { setDeciding(false); return; }
      router.replace(route.group(id));
      // A resume that quietly fails costs a launch, and must not leave a skeleton
      // nothing will fill.
      timer = setTimeout(() => setDeciding(false), 2000);
    })();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [deciding, router]);

  // Before paint: a launch arriving marked yet not deciding would otherwise hide
  // this very frame (lib/first-frame.ts).
  useLayoutEffect(() => {
    if (!deciding) clearFirstFrame();
  }, [deciding]);
  useEffect(() => clearFirstFrame, []);
  // Written on the way in: a phone gives no reliable word before it is killed.
  useEffect(() => {
    if (deciding) return;
    void setLeftOnList();
  }, [deciding]);

  return { deciding };
}

/**
 * What an icon launch onto `/install` does with what it carries (docs/ios.md).
 * **Nothing un-forgets**: a group in `leftGroups` is neither saved nor claimed.
 */
export type LaunchPlan =
  | { kind: "join"; invite: CarriedGroup }
  | { kind: "save"; fresh: CarriedGroup[]; naming: CarriedGroup[] }
  | { kind: "list" };

export function launchPlan(
  invites: readonly CarriedGroup[], held: ReadonlySet<string>, left: ReadonlySet<string>,
  meByGroup: Readonly<Record<string, string>>,
): LaunchPlan {
  const fresh = invites.filter((invite) => !held.has(invite.groupId) && !left.has(invite.groupId));
  const naming = invites.filter((invite) => invite.me && !left.has(invite.groupId)
    && !(invite.groupId in meByGroup));
  if (fresh.length === 1 && !fresh[0]!.me && naming.length === 0) return { kind: "join", invite: fresh[0]! };
  if (fresh.length || naming.length) return { kind: "save", fresh, naming };
  return { kind: "list" };
}

/**
 * **Only a copy that started on the list has a launch to spend**; one started on
 * an invite link would walk the first Back straight back into the group.
 */
export function startedOnList(url: string | undefined): boolean {
  if (!url) return true;
  let path: string;
  try {
    path = new URL(url, "http://app.invalid").pathname;
  } catch {
    return true;
  }
  return path === "/" || path === "/index.html";
}

/**
 * `navigate` covers the icon, a bookmark and a typed URL; reload and back/forward
 * mean the list is already being looked at.
 */
export function isLaunchFrom(navType: string | undefined, url: string | undefined): boolean {
  if (navType !== undefined && navType !== "navigate") return false;
  return startedOnList(url);
}

/** No window during the prerender: the first client render matches either way. */
function isLaunch(): boolean {
  if (resumed || typeof window === "undefined") return false;
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return isLaunchFrom(nav?.type, nav?.name);
}
