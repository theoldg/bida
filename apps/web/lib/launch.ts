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
 * arrow goes, and going back must not be turned around. Three things say which
 * is which — a module flag, so the resume happens once per running copy of the
 * app and never again on an in-app return; the browser's navigation type, so a
 * reload of the list you deliberately opened stays put; and the address the
 * document itself loaded at, so only a copy of the app that *started* on the
 * list is one that may leave it (`startedOnList`).
 */
let resumed = false;

/**
 * A group the app is on its way into, left here by the screen that was.
 *
 * `/join` has two halves to do and can only do one: give its own history entry
 * back to the groups list, so the group it opens has the list underneath it
 * rather than the chat the invite was tapped in — and open the group. Asked
 * for in one tick the router folds the two into the last one, so `/join` takes
 * the entry back and leaves the group here. The list picks it up on its way
 * through — it draws the frame it draws for a launch, and *pushes*. What the
 * two halves buy is a back button that climbs into the app rather than out of
 * it, and a device that has just joined is the one place the app had none.
 */
let handOver: string | undefined;

/** Open this group from the groups list, one screen under it. See `handOver`. */
export function handOverToGroup(groupId: string): void {
  handOver = groupId;
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
  const [passing] = useState(() => handOver);
  const [deciding, setDeciding] = useState(() => passing !== undefined || isLaunch());

  useEffect(() => {
    if (!deciding) return;
    // Claimed on the first decision, not on the redirect: whichever way this
    // goes, the app has now been launched, and coming back to the list later
    // is a person's choice rather than a door to be shut again.
    resumed = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    // A group handed over rather than remembered: pushed, so this list stays
    // underneath it, and spent on the way out (`handOver`). The same two-second
    // backstop below covers a push that never lands.
    if (passing) {
      handOver = undefined;
      router.push(route.group(passing));
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
  }, [deciding, passing, router]);

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
  if (nav && nav.type !== "navigate") return false;
  return startedOnList(nav?.name);
}
