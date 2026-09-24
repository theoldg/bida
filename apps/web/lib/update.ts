/**
 * A new build, taken as soon as it is safe to.
 *
 * `public/sw.js` activates the moment a build is precached and serves each open
 * page its own build. Here, a page whose build changed reloads onto the new
 * one — but not where it is standing, nor while being looked at
 * (`mayReloadHere`).
 *
 * **Never wait for every client to close** — on iOS that is nearly never. A
 * page in use is offered the tap instead (`components/update.tsx`).
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

/**
 * Screens a reload costs nothing on. `/join`, `/g/claim`, `/install` and the
 * quick split are flows; the entry form and `/new` hold typed work and warn on
 * unload. Asked by the update below and by the iOS carry
 * (`components/install.tsx`).
 */
const NOTHING_TO_LOSE = new Set(["/", "/g", "/g/balances", "/g/members", "/g/history", "/g/entry", "/about"]);

export function reloadCostsNothing(pathname: string): boolean {
  return NOTHING_TO_LOSE.has(pathname.replace(/\/$/, "") || "/");
}

/** The app's front door: the only screen an update reloads on by itself. */
const FRONT_DOOR = "/";

let stale = false;
let applying = false;
let started = false;
/** Whether a worker for this scope has reached "activated" — see `shellIsWarm`. */
let warm = false;
/** Whether the person has done anything on this page a reload would interrupt. */
let touched = false;
/** Whether the watch below is already armed; it is a singleton, like this module. */
let waiting = false;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/**
 * May the app reload itself where it is standing? **The front door only.** In
 * the installed app a reload is a relaunch: on the groups list it looks like
 * one; on a ledger it looks like a crash; on a form it raises "leave site?".
 * Waiting costs a stale screen, never a broken one — `sw.js` keeps each
 * window's cache.
 */
function mayReloadHere(): boolean {
  return (location.pathname.replace(/\/$/, "") || FRONT_DOOR) === FRONT_DOOR;
}

/**
 * Register the app-shell worker and watch for its successor. Idempotent: the
 * caller remounts, and listeners must not stack.
 */
export function registerServiceWorker(): void {
  if (started || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  started = true;

  // Resolves once a worker is active — on a first visit, once its precache
  // finishes. Only records `shellIsWarm`.
  navigator.serviceWorker.ready.then(() => { warm = true; }).catch(() => {});

  const touch = () => {
    touched = true;
    window.removeEventListener("pointerdown", touch, true);
    window.removeEventListener("keydown", touch, true);
  };
  window.addEventListener("pointerdown", touch, true);
  window.addEventListener("keydown", touch, true);

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (applying) return;
    stale = true;
    announce();
    // Untouched on the front door is a launch nobody has got to yet: go, and
    // the person never knows there was a build in between.
    const now = mayReloadHere() && !touched && document.visibilityState === "visible";
    // On the timeline because an update is when a second copy is most likely
    // left behind holding the database (lib/db/live.ts), and because which way
    // this went is the first question to ask of a phone on a stale build.
    mark("sw.controllerchange", `at ${location.pathname}: ${now ? "reload now" : "reload when free"}`);
    if (now) window.location.reload();
    else reloadWhenFree();
  });

  navigator.serviceWorker.register("/sw.js").then((registration) => {
    // The browser revalidates `sw.js` on navigation, but an installed app is
    // resumed far more often than launched. Asking again on each return to the
    // front is what makes the check happen on a phone at all.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void registration.update().catch(() => {});
    });
  }).catch(() => {
    // Offline precache is a nicety; a failed registration shouldn't be user-visible.
  });
}

/**
 * Reload the next time the app is opened somewhere it can afford to.
 *
 * **Never while hidden**: `beforeunload` can't ask, and a load begun as the app
 * is put away may not finish. A resume onto a refused screen stays armed.
 * Armed once per page, so a second build doesn't add another watcher.
 */
function reloadWhenFree(): void {
  if (waiting) return;
  waiting = true;
  let wasHidden = document.visibilityState !== "visible";
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") { wasHidden = true; return; }
    if (!wasHidden) return;
    wasHidden = false;
    if (mayReloadHere()) window.location.reload();
  });
}

/**
 * Whether a reload would come from the precache. False through a first visit's
 * first minute, while the ~2.4 MB shell downloads — a reload then races it.
 * Only `KeepCarried` asks.
 *
 * **Never `navigator.serviceWorker.controller`**: `sw.js` never calls
 * `clients.claim()`, so the installing page stays uncontrolled for life.
 */
export function shellIsWarm(): boolean {
  return warm;
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
