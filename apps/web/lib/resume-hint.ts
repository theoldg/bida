/**
 * Whether a launch is about to reopen a group, known **before paint**.
 *
 * `/` decides that in `lib/launch.ts` by reading IndexedDB, which is async —
 * and until it answers, the exported HTML of `/` is the groups list, so a
 * launch into a group flashed the list's frame first. This mirrors the one bit
 * into localStorage, which a script before the body can read, the way the
 * theme does (components/theme.tsx). The Dexie device record stays the truth:
 * a stale hint costs a moment of the ledger's skeleton before the list, and a
 * missing one costs the old flash, nothing more.
 *
 * Plain module, not "use client": the layout inlines `resumeScript`.
 */
const KEY = "bida.resume";

/** Written with `lastOpenedGroupId` and `leftOnList` (lib/db/device.ts). */
export function hintResume(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode: the list flashes, as it did before the hint.
  }
}

/**
 * Marks `<html data-resuming>` on a load that `isLaunch` (lib/launch.ts) will
 * call a launch — a `navigate` onto `/` — when the hint is set. The groups page
 * then shows the ledger's skeleton in place of its own frame (globals.css)
 * until `useResumeLastGroup` settles and takes the mark off.
 */
export const resumeScript = `try{var n=performance.getEntriesByType&&performance.getEntriesByType("navigation")[0],p=location.pathname;if((!n||n.type==="navigate")&&(p==="/"||p==="/index.html")&&localStorage.getItem("${KEY}"))document.documentElement.dataset.resuming=""}catch(e){}`;

/** Take the mark off: the list is showing, or the group has taken over. */
export function clearResuming(): void {
  if (typeof document !== "undefined") delete document.documentElement.dataset.resuming;
}
