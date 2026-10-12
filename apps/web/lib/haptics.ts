"use client";
// Doc: docs/design-system.md#nothing-waits-in-silence

/**
 * The app's one vibration. Never the thing that says an action worked: iOS has
 * none to give.
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
