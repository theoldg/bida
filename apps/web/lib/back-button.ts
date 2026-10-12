// Doc: docs/navigation.md#keeping-the-devices-back-honest
import { useEffect, useRef } from "react";
import { mark } from "./diag";
import { markReturn, sameScreen, takeOwnTraversal } from "./nav";
import { note } from "./press-trace";

type NavigateEventLike = Event & {
  navigationType: string;
  userInitiated: boolean;
  destination: { index: number; url: string };
};
type NavigationLike = EventTarget & { currentEntry: { index: number } | null };

function navigation(): NavigationLike | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { navigation?: NavigationLike }).navigation;
}

interface ScreenBack {
  up?: string;
  /**
   * `false` means it asked instead, so the press is cancelled and the screen
   * stays.
   */
  mayLeave?: () => boolean;
  /**
   * A swap, never a count back: inside a cancelled press the browser thinks we
   * are already on the destination, so `history.go(-1)` would move two.
   */
  swap: (to: string) => void;
}

/** A stack, because React mounts the next screen before unmounting this one. */
const screens: { current?: ScreenBack }[] = [];
let listening = false;

type CloseWatcherLike = { destroy(): void; onclose: ((e: Event) => void) | null };

let floor: { screen: { current?: ScreenBack }; watcher: CloseWatcherLike } | undefined;

/**
 * A close watcher only while the screen on show climbs and is the first entry of
 * this app's history: one left elsewhere would eat the press meant for the screen
 * above. Never on a screen that asks — refusing needs the same activation a
 * traversal does (ADR-0007).
 */
function settleFloor(): void {
  const top = screens[screens.length - 1];
  const back = top?.current;
  const here = navigation()?.currentEntry?.index;
  const want = back?.up !== undefined && !back.mayLeave && here === 0 ? top : undefined;
  if (floor?.screen === want) return;
  floor?.watcher.destroy();
  floor = undefined;
  const Watcher = (window as unknown as { CloseWatcher?: new () => CloseWatcherLike }).CloseWatcher;
  if (!want || !Watcher) return;
  let watcher: CloseWatcherLike;
  try { watcher = new Watcher(); } catch { return; }
  watcher.onclose = () => {
    if (floor?.watcher === watcher) floor = undefined;
    const up = want.current?.up;
    mark("back.press", `floor  up=${up} active=${navigator.userActivation?.isActive ?? "?"}`);
    note("back floor");
    if (up !== undefined) { markReturn(up); want.current?.swap(up); }
  };
  floor = { screen: want, watcher };
}

export function isBackPress(
  e: {
    navigationType: string; userInitiated: boolean; cancelable: boolean;
    destination: { index: number };
  },
  here: number | undefined,
): boolean {
  if (!e.userInitiated || e.navigationType !== "traverse") return false;
  if (here === undefined || e.destination.index >= here) return false;
  return e.cancelable;
}

function saw(e: NavigateEventLike, here: number | undefined, act: string): void {
  mark("back.press", `${act}  ${e.navigationType} to=${e.destination.index} here=${here}`
    + ` user=${e.userInitiated} cancelable=${e.cancelable}`
    + ` active=${navigator.userActivation?.isActive ?? "?"}`);
  note(`back ${act}`);
}

function onNavigate(event: Event): void {
  const e = event as NavigateEventLike;
  if (e.navigationType !== "traverse") return;
  const here = navigation()?.currentEntry?.index;
  if (takeOwnTraversal()) { saw(e, here, "ours"); return; }
  const back = screens[screens.length - 1]?.current;
  if (!back) { saw(e, here, "no screen"); return; }
  if (!isBackPress(e, here)) { saw(e, here, "not ours to take"); return; }
  if (back.mayLeave && !back.mayLeave()) { saw(e, here, "ASKED"); e.preventDefault(); return; }
  // Cancelling and re-navigating to where the browser is already going is the
  // whole of what goes wrong.
  const up = back.up;
  if (up === undefined || sameScreen(e.destination.url, up)) { saw(e, here, "let through"); return; }
  saw(e, here, "swap");
  e.preventDefault();
  // Out of the event's *task*, not merely its microtask: a navigation started
  // while the cancellation unwinds is refused outright.
  setTimeout(() => { markReturn(up); back.swap(up); }, 0);
}

export function useBackButton(back: ScreenBack | undefined): void {
  const held = useRef(back);
  held.current = back;
  useEffect(() => {
    const screen = held;
    screens.push(screen);
    const nav = navigation();
    if (nav && !listening) {
      nav.addEventListener("navigate", onNavigate);
      nav.addEventListener("currententrychange", settleFloor);
      listening = true;
    }
    settleFloor();
    return () => {
      const i = screens.indexOf(screen);
      if (i >= 0) screens.splice(i, 1);
      settleFloor();
    };
  }, []);
}
