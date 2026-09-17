/**
 * A new build, taken as soon as it is safe to.
 *
 * `public/sw.js` activates itself the moment a new build is fully precached, and
 * keeps a cache per open page, each still serving the build that page is on.
 * This file is the other half: a page that had the ground change under it
 * reloads onto the new build — but not where it is standing, and not while
 * somebody is looking at it. See `mayReloadHere`.
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

/**
 * Screens a reload costs nothing on: nothing typed, no flow half way through.
 *
 * `/join`, `/g/claim`, `/install` and the quick split are flows — a reload
 * drops somebody back at a step they have already taken — and the entry form
 * and `/new` hold what is typed in memory and warn on unload, so a reload
 * there is a browser dialog in front of somebody who only resumed the app, and
 * a lost expense if they answer it wrong.
 *
 * Two things reload the page for reasons of their own, and both ask this: the
 * update below, and the iOS carry (`components/install.tsx`).
 */
const NOTHING_TO_LOSE = new Set(["/", "/g", "/g/members", "/g/history", "/g/entry", "/about"]);

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
 * May the app reload itself where it is standing? **The front door, and
 * nowhere else.**
 *
 * In the installed app a reload is a relaunch, splash screen and all: on the
 * groups list that is the launch it already looks like, and on a ledger
 * somebody is reading it is indistinguishable from a crash. This used to
 * reload wherever the app happened to be, which put that flash — and, on the
 * two forms, the browser's own "leave site?" — in front of anyone who did
 * nothing but bring the app back to the front.
 *
 * Nothing forces the update through sooner. Holding out used to mean a page
 * left open across two deploys had its own cache deleted under it and could no
 * longer finish drawing; `sw.js` now keeps a cache per open window for as long
 * as that window is on it, so waiting for the front door costs a stale screen
 * and never a broken one.
 */
function mayReloadHere(): boolean {
  return (location.pathname.replace(/\/$/, "") || FRONT_DOOR) === FRONT_DOOR;
}

/**
 * Register the app-shell worker and watch for its successor. Idempotent: the
 * component that calls it remounts, the listeners below must not stack up.
 */
export function registerServiceWorker(): void {
  if (started || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  started = true;

  // Resolves the moment a worker for this scope is active — which on a first
  // visit is the moment its precache finishes. Nothing waits on it; it only
  // records that the shell is cached now (`shellIsWarm`).
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
    // On the timeline because an update is when a second copy of the app is
    // most likely to be left behind, holding the database (lib/db/live.ts) —
    // and because which way this went is the first question to ask of a phone
    // that is drawing a build behind the one it was told to.
    mark("sw.controllerchange", `at ${location.pathname}: ${now ? "reload now" : "reload when free"}`);
    if (now) window.location.reload();
    else reloadWhenFree();
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
 * Reload the next time the app is opened somewhere it can afford to.
 *
 * Never while it is hidden: `beforeunload` can't put its question up then, and
 * a load begun as the phone puts the app away is one the phone may not finish.
 * Coming back to the front is the honest moment — on a phone that is the app
 * being resumed, and a reload then is the launch it already looks like.
 *
 * A resume onto a screen `mayReloadHere` says no to changes nothing and stays
 * armed, so the update is taken on the first resume that finds the front door.
 * Armed once for the life of the page: a second build arriving must not leave
 * two of these watching.
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
 * Whether a reload would be served out of the precache rather than off the
 * network. False for the first visit's first minute, while the worker is still
 * fetching the ~2.4 MB shell: a reload then competes with those fetches over
 * one phone connection, which is the difference between a flash and a blank
 * screen in somebody's first minute. Only `KeepCarried` asks
 * (components/install.tsx), and only about a reload nothing on screen needs.
 *
 * `navigator.serviceWorker.controller` would be the obvious flag and is the
 * wrong one: `public/sw.js` deliberately never calls `clients.claim()`, so the
 * page that installs the worker stays uncontrolled for the whole of its life
 * and would never see one.
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
