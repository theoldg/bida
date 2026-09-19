"use client";

/**
 * The app's one vibration: a single tick, short enough to be felt and not
 * heard.
 *
 * Spent only where the interface answers something you did *not* tap — a long
 * press that decided it was a hold, a link that reached the clipboard. Both
 * already say so on screen, out from under your thumb (`design-system.md` —
 * "Nothing waits in silence"). A tap with a press wash under it needs nothing.
 *
 * **Never the thing that says an action worked.** There is no vibration on
 * iOS — no `navigator.vibrate`, no web API reaching the Taptic Engine — so
 * this can only ever be an addition to a screen that reads without it.
 */

/** Long enough to register as one tick, short enough not to buzz. */
const TICK_MS = 8;

export function tick(): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  // Vibration is motion the phone makes rather than motion on screen, and the
  // person who turned the app's animations off is the one who did not want it.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // A browser that refuses — no gesture behind the call, a permissions policy
  // — throws, and there is nothing to tell anybody about it.
  try { navigator.vibrate(TICK_MS); } catch { /* silence is the fallback */ }
}
