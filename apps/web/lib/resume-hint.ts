import { DEMO_GROUP_ID } from "@bida/core";

/**
 * Whether a launch is about to reopen a group, and what that group's ledger
 * will wear at its head, known **before paint**.
 *
 * `/` decides the resume in `lib/launch.ts` by reading IndexedDB, which is
 * async — and until it answers, the exported HTML of `/` is the groups list, so
 * a launch into a group flashed the list's frame first. This mirrors the group
 * id into localStorage, which a script before the body can read, the way the
 * theme does (components/theme.tsx). The Dexie device record stays the truth:
 * a stale hint costs a moment of the ledger's skeleton before the list, and a
 * missing one costs the old flash, nothing more.
 *
 * Plain module, not "use client": the layout inlines `resumeScript`.
 */
const KEY = "bida.resume";

/** Written with `lastOpenedGroupId` and `leftOnList` (lib/db/device.ts). */
export function hintResume(groupId: string | undefined): void {
  try {
    if (groupId) localStorage.setItem(KEY, groupId);
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode: the list flashes, as it did before the hint.
  }
}

/** The group a launch is expected to reopen. Undefined on the server. */
export function resumeHintId(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The card atop a ledger that can be known without the database: the demo's
 * mark, or the install or notifications offer (`LedgerInstall`). Chrome's
 * one-tap offer is left out — it waits on an event no script before paint has
 * seen. Pure, and tested against the functions the real cards ask.
 */
export type LedgerBanner = "demo" | "notify" | "manual" | undefined;

/**
 * `ledgerBanner` as the script runs it — the same decision, in a string. Its
 * test evaluates this against `offerFrom` and `pushStateFrom` in every
 * combination, so the two cannot drift apart.
 */
export const ledgerBannerSource = `function(id,standalone,ios,push,permission){if(id===${JSON.stringify(DEMO_GROUP_ID)})return"demo";if(standalone)return push&&permission==="default"?"notify":undefined;return ios?"manual":undefined}`;

/**
 * Marks `<html data-resuming="<banner>">` on a load that `isLaunch`
 * (lib/launch.ts) will call a launch — a `navigate` onto `/` — when the hint is
 * set. The groups page then shows the ledger's skeleton, with that banner's
 * folded card, in place of its own frame (globals.css) until
 * `useResumeLastGroup` settles and takes the mark off.
 */
export const resumeScript = `try{var n=performance.getEntriesByType&&performance.getEntriesByType("navigation")[0],p=location.pathname,id=localStorage.getItem("${KEY}"),N=navigator;if((!n||n.type==="navigate")&&(p==="/"||p==="/index.html")&&id)document.documentElement.dataset.resuming=(${ledgerBannerSource})(id,matchMedia("(display-mode: standalone)").matches||N.standalone===true,/iPad|iPhone|iPod/.test(N.userAgent)||(N.platform==="MacIntel"&&N.maxTouchPoints>1),"serviceWorker"in N&&"PushManager"in window&&"Notification"in window,window.Notification&&Notification.permission)||""}catch(e){}`;

/** Take the mark off: the list is showing, or the group has taken over. */
export function clearResuming(): void {
  if (typeof document !== "undefined") delete document.documentElement.dataset.resuming;
}
