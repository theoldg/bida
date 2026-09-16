/**
 * Staś mode: the scan's refusals, with the gloves off.
 *
 * The prompt normally tells Gemini to be light about a photo it can't use, and
 * never at the photographer's expense (`apps/api/src/scan-body.ts`). This flag
 * asks the Worker for the other prompt, the one that answers a picture of
 * somebody's thumb the way the group chat would. It changes nothing but the
 * wording of `error` — the reading of an actual receipt is the same prompt
 * either way.
 *
 * It lives in `localStorage` rather than the device record for the same reason
 * the theme does: the one screen that sets it (`app/diag/page.tsx`) is the
 * screen that must never wait on Dexie, and a scan asks for this flag while
 * the photo is already being resized. A private-mode refusal costs the
 * setting, nothing else.
 */
const KEY = "bida.stas";

export function stasMode(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setStasMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch { /* private mode: the toggle is this session's, and that is all */ }
}
