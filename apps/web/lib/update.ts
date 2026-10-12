// Doc: docs/pwa.md
/** A new build, taken as soon as it is safe to — never mid-use. */

import { useEffect } from "react";
import { mark } from "./diag";
import { signal } from "./signal";

export type UpdateState =
  | "none"
  | "ready"
  | "applying";

/**
 * `/join`, `/g/claim`, `/install` and the quick split are flows; the entry form
 * and `/new` hold typed work.
 */
const NOTHING_TO_LOSE = new Set(["/", "/g", "/g/balances", "/g/members", "/g/history", "/g/entry", "/about"]);

export function reloadCostsNothing(pathname: string): boolean {
  return NOTHING_TO_LOSE.has(pathname.replace(/\/$/, "") || "/");
}

/** What only this page's memory holds — an open dialog, a half-typed name. */
let holds = 0;

export function useHoldsWork(holding: boolean): void {
  useEffect(() => {
    if (!holding) return;
    holds++;
    return () => { holds--; };
  }, [holding]);
}

const FRONT_DOOR = "/";

/** Away this long, a fresh screen reads as having left, not as a crash. */
export const AWAY_MS = 60_000;

let stale = false;
let applying = false;
let started = false;
let warm = false;
let touched = false;
let waiting = false;
const { emit: announce, subscribe } = signal();

function atFrontDoor(pathname: string): boolean {
  return (pathname.replace(/\/$/, "") || FRONT_DOOR) === FRONT_DOOR;
}

/**
 * On the list a reload looks like a relaunch, so always; on a ledger, only after
 * `AWAY_MS`, as launches resume the last group; on a form or a flow, or while
 * something is held, never. Waiting costs a stale screen, never a broken one.
 */
export function mayReloadOnReturn(pathname: string, awayMs: number, holding = false): boolean {
  if (holding) return false;
  if (atFrontDoor(pathname)) return true;
  return awayMs >= AWAY_MS && reloadCostsNothing(pathname);
}

/** Idempotent: the caller remounts, and listeners must not stack. */
export function registerServiceWorker(): void {
  if (started || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  started = true;

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
    // Untouched on the front door: the person never knows there was a build
    // between.
    const now = atFrontDoor(location.pathname) && !touched && document.visibilityState === "visible";
    // An update is when a second copy is most likely left holding the database.
    mark("sw.controllerchange", `at ${location.pathname}: ${now ? "reload now" : "reload when free"}`);
    if (now) window.location.reload();
    else reloadWhenFree();
  });

  navigator.serviceWorker.register("/sw.js").then((registration) => {
    nudgeWhileWaiting(registration);
    registration.addEventListener("updatefound", () => {
      const sw = registration.installing;
      sw?.addEventListener("statechange", () => { if (sw.state === "installed") nudgeWhileWaiting(registration); });
    });
    // An installed app is resumed far more often than launched, so ask on each
    // return.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void registration.update().catch(() => {});
    });
  }).catch(() => {
    // A failed registration shouldn't be user-visible.
  });
}

/**
 * A worker that called `skipWaiting` while the old one was busy can be left
 * waiting for good: Chromium tries the activation once, at the end of the
 * install, and not again. Asking again is what moves it (`sw.js`'s message).
 */
const NUDGE_MS = 5000;
const NUDGES = 12;
let nudging = false;

export function nudgeWhileWaiting(registration: ServiceWorkerRegistration): void {
  if (nudging || !registration.waiting) return;
  nudging = true;
  let left = NUDGES;
  const ask = () => {
    const waiting = registration.waiting;
    if (!waiting || left-- <= 0) { nudging = false; return; }
    mark("sw.nudge", `${NUDGES - left}`);
    waiting.postMessage({ type: "skip-waiting" });
    setTimeout(ask, NUDGE_MS);
  };
  setTimeout(ask, NUDGE_MS);
}

/**
 * **Never while hidden**: `beforeunload` can't ask, and a load begun as the app
 * is put away may not finish.
 */
function reloadWhenFree(): void {
  if (waiting) return;
  waiting = true;
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
 * False while a first visit's ~2.4 MB shell downloads. **Never
 * `navigator.serviceWorker.controller`**: `sw.js` never claims clients.
 */
export function shellIsWarm(): boolean {
  return warm;
}

export const subscribeUpdate = subscribe;

/** A string: `useSyncExternalStore` compares snapshots by identity. */
export function updateState(): UpdateState {
  if (applying) return "applying";
  return stale ? "ready" : "none";
}

export function applyUpdate(): void {
  if (applying) return;
  applying = true;
  announce();
  window.location.reload();
}
