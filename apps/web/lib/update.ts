/**
 * A new build, taken as soon as it is safe to.
 *
 * `public/sw.js` activates itself the moment a new build is fully precached, and
 * keeps the previous build's cache for the pages already running it. This file
 * is the other half: a page that just had the ground change under it reloads
 * onto the new build — at once if nobody has touched it yet, otherwise the next
 * time it comes back to the foreground, so nothing half-typed vanishes.
 *
 * It used to be a tap. The worker waited for every client of the origin to
 * close, and on iOS Safari that is close to never: tabs, and the browser, live
 * through what a person thinks of as quitting, so people killed Safari over and
 * over to get a deploy. The offer is still drawn in the installed app for a page
 * that is being used when the update lands (`components/update.tsx`).
 */

import { mark } from "./diag";

/** What, if anything, there is to offer. */
export type UpdateState =
  /** Running the newest build we know of. */
  | "none"
  /** A new build took over; this page is still the old one until it reloads. */
  | "ready"
  /** The tap happened; the reload is on its way. */
  | "applying";

let stale = false;
let applying = false;
let started = false;
/** Whether the person has done anything on this page a reload would interrupt. */
let touched = false;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/**
 * Register the app-shell worker and watch for its successor. Idempotent: the
 * component that calls it remounts, the listeners below must not stack up.
 */
export function registerServiceWorker(): void {
  if (started || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  started = true;

  const touch = () => {
    touched = true;
    window.removeEventListener("pointerdown", touch, true);
    window.removeEventListener("keydown", touch, true);
  };
  window.addEventListener("pointerdown", touch, true);
  window.addEventListener("keydown", touch, true);

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // On the timeline because an update is when a second copy of the app is
    // most likely to be left behind, holding the database (lib/db/live.ts).
    mark("sw.controllerchange", touched ? "reload on resume" : "reload now");
    if (applying) return;
    stale = true;
    announce();
    // The worker serves this page its own build for now (`previousFor` in
    // sw.js), but only until the worker is next restarted without its record,
    // or the next deploy — so it goes as soon as going costs nothing.
    if (!touched && document.visibilityState === "visible") window.location.reload();
    else reloadOnResume();
  });

  navigator.serviceWorker.register("/sw.js").then((registration) => {
    // The browser revalidates `sw.js` on navigation, but an installed app — and
    // a Safari tab — is resumed far more often than it is launched. Asking again
    // each time it comes back to the front is what makes the check happen on a
    // phone at all.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void registration.update().catch(() => {});
    });
  }).catch(() => {
    // Offline precache is a nicety; a failed registration shouldn't be user-visible.
  });
}

/**
 * Reload the next time this page is brought back, never while it is hidden:
 * `beforeunload` can't put its question up then, so the half-typed expense on
 * `/g/entry/edit` would go without being asked about. Coming back is both safe
 * and the honest moment — on a phone it is the app being resumed, and a reload
 * then is the launch it already looks like.
 */
function reloadOnResume(): void {
  let hidden = document.visibilityState !== "visible";
  const seen = () => {
    if (document.visibilityState !== "visible") {
      hidden = true;
      return;
    }
    if (!hidden) return;
    document.removeEventListener("visibilitychange", seen);
    window.location.reload();
  };
  document.addEventListener("visibilitychange", seen);
}

export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** A string, not an object: `useSyncExternalStore` compares snapshots by identity. */
export function updateState(): UpdateState {
  if (applying) return "applying";
  return stale ? "ready" : "none";
}

/** Take the new build now, rather than on the next resume. */
export function applyUpdate(): void {
  if (applying) return;
  applying = true;
  announce();
  window.location.reload();
}
