import { DEMO_GROUP_ID } from "@bida/core";

/**
 * **What a launch will show, decided before paint.** One question with one
 * answer, `firstFrame`, asked twice: by the script inlined first in the body,
 * which marks `<html data-frame>` for CSS to pick a frame by, and by the tests
 * against the code that later makes the real decision.
 *
 * A launch lands on a route whose exported HTML is the wrong picture: `/` is
 * the groups list, though a launch may reopen a group; `/install`, the iOS
 * icon's `start_url`, is the tutorial (docs/ios.md). The real decisions read
 * IndexedDB, which answers after first paint, so what the script needs is
 * mirrored into localStorage, the way the theme is: the group a launch will
 * reopen (`hintResume`) and whether this app was ever launched from the icon
 * (`markLaunched`). The database stays the truth — a stale mirror costs one
 * frame of the wrong skeleton, nothing more.
 *
 * Plain module, not "use client": the layout inlines `firstFrameScript`.
 */

/** The skeleton a launch wears until its screen takes over (`FirstFrames`). */
export type FirstFrame = "ledger" | "list" | "join";

const HINT = "bida.resume";
const LAUNCHED = "bida.launched";

/** Written with `lastOpenedGroupId` and `leftOnList` (lib/db/device.ts). */
export function hintResume(groupId: string | undefined): void {
  try {
    if (groupId) localStorage.setItem(HINT, groupId);
    else localStorage.removeItem(HINT);
  } catch {
    // Private mode: a launch shows the list's frame first, as before the hint.
  }
}

/** The group a launch is expected to reopen. Undefined on the server. */
export function resumeHintId(): string | undefined {
  try {
    return localStorage.getItem(HINT) ?? undefined;
  } catch {
    return undefined;
  }
}

/** An icon launch was handled here: no later one can be a first join (`launchPlan`). */
export function markLaunched(): void {
  try {
    localStorage.setItem(LAUNCHED, "1");
  } catch {
    // Every later launch of a newcomer's icon then shows "Joining…" a moment.
  }
}

/**
 * The frame a load should paint, or undefined for the route's own.
 *
 * - **Only a launch**: a `navigate` (`isLaunchFrom`, lib/launch.ts). Reload
 *   and back/forward land where the person already was.
 * - **`/`** reopens the hinted group (`useResumeLastGroup`).
 * - **`/install` in the installed app** is the icon: one carried group nobody
 *   is named in, on an app never launched before, is a newcomer bound for
 *   `/join`; anything else goes to the list, which may reopen the hint
 *   (`launchPlan`).
 *
 * **Serialised into the script**, so it may use nothing but its arguments —
 * no imports, no helpers, nothing a compiler might hoist out of it.
 */
export function firstFrame(
  path: string, navType: string | undefined, standalone: boolean,
  hint: string | null, launched: boolean, hash: string,
): FirstFrame | undefined {
  if (navType !== undefined && navType !== "navigate") return undefined;
  if (path === "/" || path === "/index.html") return hint ? "ledger" : undefined;
  if (!standalone || (path !== "/install" && path !== "/install.html")) return undefined;
  const parts = hash.replace(/^#/, "").split("~");
  const only = parts.length === 1 ? parts[0]!.split(".") : [];
  const token = /^[A-Za-z0-9_-]+$/;
  if (!launched && only.length === 2 && token.test(only[0]!) && token.test(only[1]!)) return "join";
  return hint ? "ledger" : "list";
}

/**
 * The card atop a ledger that can be known without the database: the demo's
 * mark, or the install or notifications offer (`LedgerInstall`). Chrome's
 * one-tap offer is left out — it waits on an event no script before paint has
 * seen. Tested against `offerFrom` and `pushStateFrom` in every combination.
 * Serialised like `firstFrame`, so the demo's id comes in as an argument.
 */
export function ledgerBanner(
  id: string, demo: string, standalone: boolean, ios: boolean, push: boolean,
  permission: string | undefined,
): LedgerBanner {
  if (id === demo) return "demo";
  if (standalone) return push && permission === "default" ? "notify" : undefined;
  return ios ? "manual" : undefined;
}

export type LedgerBanner = "demo" | "notify" | "manual" | undefined;

/**
 * Marks `<html data-frame="<FirstFrame>">`, and on a ledger
 * `data-banner="<LedgerBanner>"` for its folded card (globals.css). Taken off
 * by `clearFirstFrame` once the launch has landed.
 */
export const firstFrameScript = `try{var N=navigator,n=performance.getEntriesByType&&performance.getEntriesByType("navigation")[0],d=document.documentElement,s=matchMedia("(display-mode: standalone)").matches||N.standalone===true,h=localStorage.getItem("${HINT}"),f=(${firstFrame})(location.pathname,n?n.type:undefined,s,h,localStorage.getItem("${LAUNCHED}")==="1",location.hash);if(f){d.dataset.frame=f;if(f==="ledger")d.dataset.banner=(${ledgerBanner})(h,${JSON.stringify(DEMO_GROUP_ID)},s,/iPad|iPhone|iPod/.test(N.userAgent)||(N.platform==="MacIntel"&&N.maxTouchPoints>1),"serviceWorker"in N&&"PushManager"in window&&"Notification"in window,window.Notification?Notification.permission:undefined)||""}}catch(e){}`;

/** Whether this load was marked: read once, by the screens that draw `FirstFrames`. */
export function firstFrameMarked(): boolean {
  return document.documentElement.hasAttribute("data-frame");
}

/** The launch has landed — on the list, or on whatever replaced it. */
export function clearFirstFrame(): void {
  if (typeof document === "undefined") return;
  delete document.documentElement.dataset.frame;
  delete document.documentElement.dataset.banner;
}
