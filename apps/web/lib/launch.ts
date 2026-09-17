"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Group } from "@bida/core";
import { getDevice, setLeftOnList } from "./db/device";
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
 * Unless the list is where you left off. Backing out of a group is how a
 * person says they are done with it, and an app that walks straight back in
 * on the next launch has ignored the one instruction it was given — so the
 * list records itself as this device's place (`setLeftOnList`) exactly as a
 * group does, and a launch reopens whichever of the two was last.
 *
 * A *launch*, and not every arrival at `/`: the list is still where the back
 * arrow goes, and going back must not be turned around. That question has one
 * answer and one home — `arrival`, below.
 */

/**
 * What brought the app to the groups list, and so what the list owes it.
 *
 * One value, because this was three flags reaching the same `useResumeLastGroup`
 * by different routes, and every screen that learned to send somebody to the
 * list added a fourth way to be wrong about it. The answers, in the order the
 * hook spends them:
 *
 * - **A group handed over** by `/join` (`handOverToGroup`). That screen has two
 *   halves to do and can only do one: give its own history entry back to the
 *   list, so the group it opens has the list underneath it rather than the chat
 *   the invite was tapped in — and open the group. Asked for in one tick the
 *   router folds the two into the last one, so `/join` takes the entry back and
 *   leaves the group here. The list picks it up on its way through and
 *   *pushes*, which is what makes the back button climb into the app rather
 *   than out of it.
 * - **A launch** the list was told about (`launchedOnto`). `/install` is the
 *   one caller: the iOS icon's `start_url` is `/install#<carry>`, so the
 *   document never loads on the list and `startedOnList` rightly says this copy
 *   of the app did not start there. Without a word from `/install` every launch
 *   of that icon — the install the whole of docs/ios.md exists to produce —
 *   landed on the list with the group you were last in unopened, while the same
 *   phone's Android install reopened it.
 * - **Nothing**, and the browser is asked instead (`isLaunch`).
 *
 * Spent on the first decision either way: whichever way that goes, the app has
 * now been launched, and coming back to the list later is a person's choice
 * rather than a door to be shut again.
 */
let arrival: { kind: "group"; groupId: string } | { kind: "launch" } | undefined;
/** Set once the hook has spent `arrival`, so an in-app return is never a launch. */
let resumed = false;

/** Open this group from the groups list, one screen under it. See `arrival`. */
export function handOverToGroup(groupId: string): void {
  arrival = { kind: "group", groupId };
}

/** The arrival at the groups list this is about to cause is a launch. See `arrival`. */
export function launchedOnto(): void {
  arrival = { kind: "launch" };
}

/**
 * Which group a launch should reopen, if any. Pure, and exported for its test:
 * reading the device record and the group is the hook's job below.
 *
 * A group this phone has forgotten (`leftGroups`) or archived is not somewhere
 * to be put back into, and neither is one whose row is gone — the id outlives
 * the group it names, since nothing clears it when a group is forgotten. Nor
 * is one you left behind on the list (`leftOnList`): the id outlives that too,
 * because `/new` and `/quick` still want it for their currency.
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
 * True while a fresh load of `/` is still deciding whether to reopen a group,
 * so the caller draws its loading frame rather than a list that is about to be
 * replaced. Answers `false` — and stays there — on every arrival that isn't a
 * launch.
 */
export function useResumeLastGroup(): boolean {
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
      router.push(route.group(came.groupId));
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
      // Still here a moment later means the replace didn't take — the router
      // is the app's, not the browser's, and this is the first thing asked of
      // it. Whatever the cause, the answer is the list: a resume that quietly
      // fails must cost a launch, not leave the app on a skeleton nothing
      // will ever fill.
      timer = setTimeout(() => setDeciding(false), 2000);
    })();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [deciding, came, router]);

  // Settled on the list — a launch that found nowhere to go, an in-app return,
  // a reload — and so the list is this device's place until a group takes it
  // back. Written on the way in rather than on the way out, because a phone
  // gives no reliable word before the app is killed.
  useEffect(() => {
    if (deciding) return;
    void setLeftOnList();
  }, [deciding]);

  return deciding;
}

/**
 * Did the document itself load on the groups list?
 *
 * The app is one document for its whole life, so the navigation type below
 * says how *that* load happened and never changes again, however many screens
 * are walked through after it. An invite link is the case that made this
 * matter: it loads the document on `/join`, lands in the group without ever
 * drawing the list, and the first press of Back was then read as a launch —
 * the list flashed and the app walked straight back into the group it had just
 * been asked to leave. Only a copy of the app that started on the list has a
 * launch to spend on reopening a group; one that started on a link has already
 * spent it on the link. An address that cannot be read is taken for the list,
 * which is the old answer.
 *
 * Pure, and exported for its test: reading the timing entry is the caller's.
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
 * Is this arrival the app being started, as the browser tells it?
 *
 * `navigate` covers the home-screen icon, a bookmark and a typed URL; a reload
 * and a back/forward traversal are excluded, because both mean this list is
 * the screen already being looked at.
 *
 * Pure, and exported for its test: reading the timing entry is the caller's.
 */
export function isLaunchFrom(navType: string | undefined, url: string | undefined): boolean {
  if (navType !== undefined && navType !== "navigate") return false;
  return startedOnList(url);
}

/**
 * The same question, of the browser this is running in. During the static
 * export's build-time prerender there is no window, and the answer is no — the
 * first client render then matches the server's, which is the same skeleton
 * either way.
 */
function isLaunch(): boolean {
  if (resumed || typeof window === "undefined") return false;
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return isLaunchFrom(nav?.type, nav?.name);
}
