"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Group } from "@bida/core";
import { getDevice, setLeftOnList } from "./db/device";
import { db, type DeviceRecord } from "./db/dexie";
import { route } from "./group-link";

/**
 * Launching the app puts you back in the group you were last in (`/g` records
 * it with `setLastOpenedGroup`) — unless the list is where you left off:
 * backing out of a group records the list as this device's place
 * (`setLeftOnList`), and a launch reopens whichever was last.
 *
 * **A launch, not every arrival at `/`.** The list is where back arrows go, and
 * going back must not be turned around. That question lives in `arrival`.
 */

/**
 * What brought the app to the groups list, and so what the list owes it.
 * **One value, not a flag per caller.** In the order the hook spends them:
 *
 * - **A group handed over** by `/join` (`handOverToGroup`). `/join` must give
 *   its history entry back to the list *and* open the group, and the router
 *   folds two calls in one tick into the last — so `/join` goes back, and the
 *   list *pushes* the group, making Back climb into the app, not out of it.
 * - **A launch** the list was told about (`launchedOnto`), from `/install`
 *   alone: the iOS icon's `start_url` is `/install#<carry>`, so
 *   `startedOnList` rightly says no — and without this every icon launch
 *   lands on the list with the last group unopened.
 * - **Nothing**, and the browser is asked instead (`isLaunch`).
 *
 * Spent on the first decision either way.
 */
let arrival: { kind: "group"; href: string } | { kind: "launch" } | undefined;
/** Set once the hook has spent `arrival`, so an in-app return is never a launch. */
let resumed = false;

/**
 * Open this group from the groups list, one screen under it. See `arrival`.
 * `claim` sends it to `/g/claim` rather than the ledger, which would only draw
 * its skeleton before `useClaimGate` sent it there anyway.
 */
export function handOverToGroup(groupId: string, { claim = false } = {}): void {
  arrival = { kind: "group", href: claim ? route.claim(groupId) : route.group(groupId) };
}

/** The arrival at the groups list this is about to cause is a launch. See `arrival`. */
export function launchedOnto(): void {
  arrival = { kind: "launch" };
}

/**
 * Which group a launch should reopen, if any. Pure, exported for its test.
 *
 * Not one this phone forgot (`leftGroups`), archived, or whose row is gone —
 * the id outlives all of those. Nor one left for the list (`leftOnList`); the
 * id stays because `/new` and `/quick` want its currency.
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

/**
 * `deciding` is true while a fresh load of `/` is deciding whether to reopen a
 * group, so the caller draws its loading frame rather than a list about to be
 * replaced — `false`, for good, on every non-launch arrival. `joining` says the
 * group was handed over by `/join`, whose frame the list should keep drawing
 * until the push lands: one "Joining…" from the link to the question.
 */
export function useResumeLastGroup(): { deciding: boolean; joining: boolean } {
  const router = useRouter();
  // Read rather than spent in the initialiser, which React may run twice.
  const [came] = useState(() => arrival);
  const [deciding, setDeciding] = useState(() => came !== undefined || isLaunch());

  useEffect(() => {
    if (!deciding) return;
    // Spent on the first decision, not on the redirect (`arrival`).
    arrival = undefined;
    resumed = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    // A group handed over rather than remembered: pushed, so this list stays
    // underneath it. The same two-second backstop below covers a push that
    // never lands.
    if (came?.kind === "group") {
      router.push(came.href);
      timer = setTimeout(() => setDeciding(false), 2000);
      return () => clearTimeout(timer);
    }
    void (async () => {
      const device = await getDevice();
      const last = device.lastOpenedGroupId;
      const group = last ? await db().groups.get(last) : undefined;
      if (cancelled) return;
      const id = resumeGroupId(device, group);
      if (!id) { setDeciding(false); return; }
      router.replace(route.group(id));
      // Still here a moment later means the replace didn't take. Whatever the
      // cause, the answer is the list: a resume that quietly fails costs a
      // launch, and must not leave the app on a skeleton nothing will fill.
      timer = setTimeout(() => setDeciding(false), 2000);
    })();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [deciding, came, router]);

  // Settled on the list, so the list is this device's place until a group takes
  // it back. Written on the way in: a phone gives no reliable word before the
  // app is killed.
  useEffect(() => {
    if (deciding) return;
    void setLeftOnList();
  }, [deciding]);

  return { deciding, joining: deciding && came?.kind === "group" };
}

/**
 * Did the document itself load on the groups list? The navigation type
 * describes that one load for the app's whole life. **Only a copy that
 * started on the list has a launch to spend**; one started on an invite link
 * already spent it, and the first Back out of that group would otherwise walk
 * straight back in. An unreadable address counts as the list.
 *
 * Pure, and exported for its test.
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
 * Is this arrival the app being started? `navigate` covers the icon, a
 * bookmark and a typed URL; reload and back/forward mean the list is already
 * being looked at. Pure, and exported for its test.
 */
export function isLaunchFrom(navType: string | undefined, url: string | undefined): boolean {
  if (navType !== undefined && navType !== "navigate") return false;
  return startedOnList(url);
}

/**
 * The same question of this browser. No window during the static prerender,
 * so no — the first client render matches the same skeleton either way.
 */
function isLaunch(): boolean {
  if (resumed || typeof window === "undefined") return false;
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return isLaunchFrom(nav?.type, nav?.name);
}
