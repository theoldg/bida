"use client";

/**
 * The app's one vibration: a single tick, short enough to be felt and not
 * heard.
 *
 * It is spent where the interface answers something you did *not* tap — a long
 * press that has decided it was a hold rather than a mis-touch, and a link that
 * has reached the clipboard. Both already say so on screen (`design-system.md`
 * — "Nothing waits in silence"), and neither is under your thumb when it does:
 * the menu opens above the finger holding the row, and the check that replaces
 * the link glyph is a small mark in a top bar. A tap with a press wash under it
 * needs nothing added.
 *
 * Not on iOS, where `navigator.vibrate` does not exist and there is no web API
 * that reaches the Taptic Engine — so this has to be an addition to a screen
 * that already reads without it, never the thing that says an action worked.
 */

/** Long enough to register as one tick, short enough not to buzz. */
const TICK_MS = 8;

export function tick(): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  // Vibration is motion the phone makes rather than motion on screen, and the
  // person who turned the app's animations off is the one who did not want it.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // A browser that refuses — no gesture behind the call, a permissions policy —
  // throws, and there is nothing to tell anybody about it.
  try { navigator.vibrate(TICK_MS); } catch { /* silence is the fallback */ }
}
