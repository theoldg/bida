"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Group } from "@bida/core";
import { getDevice } from "./db/device";
import { db, type DeviceRecord } from "./db/dexie";
import { route } from "./group-link";

/**
 * Launching the app puts you back in the group you were last in.
 *
 * Nearly everyone is in one group at a time — a trip, a flat — so the groups
 * list was a screen you passed through on the way to the only thing you came
 * for. `/g` already records which group that was (`setLastOpenedGroup`, kept
 * for `/new`'s currency default); this reads it back at the door.
 *
 * A *launch*, and not every arrival at `/`: the list is still where the back
 * arrow goes, and going back must not be turned around. Two things say which
 * is which — a module flag, so the resume happens once per running copy of the
 * app and never again on an in-app return, and the browser's navigation type,
 * so a reload of the list you deliberately opened, or a press of Back onto it,
 * stays put.
 */
let resumed = false;

/**
 * Which group a launch should reopen, if any. Pure, and exported for its test:
 * reading the device record and the group is the hook's job below.
 *
 * A group this phone has forgotten (`leftGroups`) or archived is not somewhere
 * to be put back into, and neither is one whose row is gone — the id outlives
 * the group it names, since nothing clears it when a group is forgotten.
 */
export function resumeGroupId(
  device: Pick<DeviceRecord, "lastOpenedGroupId" | "leftGroups"> | undefined,
  group: Pick<Group, "id" | "archivedAt"> | undefined,
): string | undefined {
  const id = device?.lastOpenedGroupId;
  if (!id || !group || group.id !== id) return undefined;
  if (device?.leftGroups?.includes(id) || group.archivedAt) return undefined;
  return id;
}

/**
 * True while a fresh load of `/` is still deciding whether to reopen a group,
 * so the caller draws its loading frame rather than a list that is about to be
 * replaced. Answers `false` — and stays there — on every arrival that isn't a
 * launch.
 */
export function useResumeLastGroup(): boolean {
  const router = useRouter();
  const [deciding, setDeciding] = useState(isLaunch);

  useEffect(() => {
    if (!deciding) return;
    // Claimed on the first decision, not on the redirect: whichever way this
    // goes, the app has now been launched, and coming back to the list later
    // is a person's choice rather than a door to be shut again.
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
      // Still here a moment later means the replace didn't take — the router
      // is the app's, not the browser's, and this is the first thing asked of
      // it. Whatever the cause, the answer is the list: a resume that quietly
      // fails must cost a launch, not leave the app on a skeleton nothing
      // will ever fill.
      timer = setTimeout(() => setDeciding(false), 2000);
    })();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [deciding, router]);

  return deciding;
}

/**
 * Is this arrival the app being started?
 *
 * `navigate` covers the home-screen icon, a bookmark and a typed URL; a reload
 * and a back/forward traversal are excluded, because both mean this list is
 * the screen already being looked at. During the static export's build-time
 * prerender there is no window, and the answer is no — the first client render
 * then matches the server's, which is the same skeleton either way.
 */
function isLaunch(): boolean {
  if (resumed || typeof window === "undefined") return false;
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return !nav || nav.type === "navigate";
}
