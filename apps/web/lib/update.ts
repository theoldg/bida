// Doc: docs/pwa.md
/** A new build, taken as soon as it is safe to — never mid-use. */

import { useEffect } from "react";
import { mark } from "./diag";
import { signal } from "./signal";

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

/**
 * What the screen is holding that only this page's memory has: an open dialog,
 * a half-typed name, a search. The list above names screens, not moments, and
 * `mayReloadOnReturn` asks both.
 */
let holds = 0;

/** While `holding`, no return to the front reloads this page. */
export function useHoldsWork(holding: boolean): void {
  useEffect(() => {
    if (!holding) return;
    holds++;
    return () => { holds--; };
  }, [holding]);
}

/** The app's front door: the one screen an update reloads on at once. */
const FRONT_DOOR = "/";

/**
 * Away this long, coming back to a fresh screen reads as having left — not as a
 * crash. Shorter would catch an app switch to copy a number mid-read.
 */
export const AWAY_MS = 60_000;

let stale = false;
let applying = false;
let started = false;
/** Whether a worker for this scope has reached "activated" — see `shellIsWarm`. */
let warm = false;
/** Whether the person has done anything on this page a reload would interrupt. */
let touched = false;
/** Whether the watch below is already armed; it is a singleton, like this module. */
let waiting = false;
const { emit: announce, subscribe } = signal();

function atFrontDoor(pathname: string): boolean {
  return (pathname.replace(/\/$/, "") || FRONT_DOOR) === FRONT_DOOR;
}

/**
 * May the app reload itself as it comes back to the front, having been away
 * `awayMs`? In the installed app a reload is a relaunch: on the groups list it
 * looks like one, so always; on a ledger after a short switch it looks like a
 * crash, so only after `AWAY_MS` — launches resume the last group
 * (`lib/launch.ts`), so waiting for the list alone left most phones on an old
 * build for days; on a form or a flow it would lose work, so never — nor
 * anywhere while something is `holding` (`useHoldsWork`). Waiting costs a
 * stale screen, never a broken one — `sw.js` keeps each window's cache.
 */
export function mayReloadOnReturn(pathname: string, awayMs: number, holding = false): boolean {
  if (holding) return false;
  if (atFrontDoor(pathname)) return true;
  return awayMs >= AWAY_MS && reloadCostsNothing(pathname);
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
    const now = atFrontDoor(location.pathname) && !touched && document.visibilityState === "visible";
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
  // When the page last went hidden; null while it is in front.
  let hiddenAt: number | null = document.visibilityState !== "visible" ? Date.now() : null;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") { hiddenAt ??= Date.now(); return; }
    if (hiddenAt === null) return;
    const away = Date.now() - hiddenAt;
    hiddenAt = null;
    if (mayReloadOnReturn(location.pathname, away, holds > 0)) window.location.reload();
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

export const subscribeUpdate = subscribe;

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
