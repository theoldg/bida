/**
 * "A new version is ready" — a waiting service worker, and the one gesture that
 * takes it.
 *
 * `public/sw.js` never calls `skipWaiting` itself, and that decision is the
 * whole reason this file exists. Activating mid-session deletes the cache the
 * open page is being served from, and that build is already gone from the
 * server, so the next chunk it lazily asks for is a 404. The new worker
 * therefore sits in `waiting` until every client of the origin has closed.
 *
 * "Which on a phone is constantly" turned out to be false. One forgotten
 * browser tab on the same origin is a client, and it pins the old worker for as
 * long as it lives; the installed app is then stuck on an old build with
 * nothing on screen to say so, and no way to ask for the new one. So: notice
 * the waiting worker, say so, and let a tap discard this page. A reload is what
 * makes activating safe — and here it is the person asking for it.
 */

import { mark } from "./diag";

/** What, if anything, there is to offer. */
export type UpdateState =
  /** Running the newest build we know of. */
  | "none"
  /** A worker has installed and is waiting for this page to go. */
  | "ready"
  /** The tap happened; the reload is on its way. */
  | "applying";

let waiting: ServiceWorker | undefined;
let applying = false;
let started = false;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/**
 * A worker only counts once it is `installed` *and* something is already
 * controlling the page. Without the second test this fires on the very first
 * registration, which is not an update — it is the app arriving.
 */
function offer(worker: ServiceWorker | null | undefined): void {
  if (!worker || worker.state !== "installed") return;
  if (!navigator.serviceWorker.controller) return;
  if (waiting !== worker) mark("sw.waiting");
  waiting = worker;
  announce();
}

/** Follow a worker that is still installing to whatever it becomes. */
function watch(worker: ServiceWorker | null): void {
  if (!worker) return;
  worker.addEventListener("statechange", () => offer(worker));
}

/**
 * Register the app-shell worker and watch for its successor. Idempotent: the
 * component that calls it remounts, the listeners below must not stack up.
 */
export function registerServiceWorker(): void {
  if (started || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  started = true;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // On the timeline because an update is when a second copy of the app is
    // most likely to be left behind, holding the database (lib/db/live.ts).
    mark("sw.controllerchange", applying ? "asked for" : "another copy's update");
    // The activation `applyUpdate` asked for: reload, as it promised to.
    if (applying) {
      window.location.reload();
      return;
    }
    // Somebody else's tap, heard by every client of the origin — and for one
    // that didn't ask, it is the ground going: `activate` has just deleted the
    // cache this page is running out of. Carrying on is what a person sees as
    // a group screen turning into "No group" with no tabs on it
    // (docs/frontend.md#gotchas), so this page goes too, gently.
    reloadWhenSeen();
  });

  navigator.serviceWorker.register("/sw.js").then((registration) => {
    // Three ways to arrive at the same worker, and all three are needed. It may
    // already be waiting — installed during an earlier launch and sitting there
    // ever since, which is the common case on the phone this was written for.
    // It may be mid-install right now, having been started by this very
    // navigation before our listener existed. Or it may not have appeared yet.
    offer(registration.waiting);
    watch(registration.installing);
    registration.addEventListener("updatefound", () => watch(registration.installing));

    // The browser revalidates `sw.js` on navigation, but an installed app is
    // resumed far more often than it is launched: it navigates once and then
    // lives in the background for days. Asking again each time it comes back to
    // the front is what makes the check happen on a phone at all.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void registration.update().catch(() => {});
    });
  }).catch(() => {
    // Offline precache is a nicety; a failed registration shouldn't be user-visible.
  });
}

/**
 * Reload a page left behind by somebody else's update — at the moment it is
 * looked at again, not the moment it is stranded.
 *
 * Hidden is precisely when a reload must not happen: `beforeunload` can't put
 * its question up, so the half-typed expense on `/g/entry/edit` would go
 * without being asked about. Coming back is both safe and the honest moment —
 * on a phone the stranded client is the app in the background, and a reload as
 * it is resumed is the launch it already looks like.
 */
function reloadWhenSeen(): void {
  if (document.visibilityState === "visible") {
    window.location.reload();
    return;
  }
  const seen = () => {
    if (document.visibilityState !== "visible") return;
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
  return waiting ? "ready" : "none";
}

/**
 * Take the new build: tell the waiting worker to activate, and reload when it
 * has. The reload is the point — it is what leaves nothing behind that could
 * ask for a chunk from the cache `activate` is about to delete.
 */
export function applyUpdate(): void {
  if (applying) return;
  applying = true;
  announce();

  const worker = waiting;
  // Nothing waiting means it activated by itself between the offer and the tap.
  // A reload is still the whole answer; it is only the message that is moot.
  if (!worker) {
    window.location.reload();
    return;
  }
  worker.postMessage({ type: "skip-waiting" });
  // `controllerchange` is the signal. This is the floor under it, for a worker
  // that never answers — a second reload can't happen, the first unloads us.
  window.setTimeout(() => window.location.reload(), 3000);
}
