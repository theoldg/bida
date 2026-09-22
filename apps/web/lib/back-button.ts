/**
 * The device's back button, doing what the screen's back arrow does.
 *
 * The arrow goes *up* ([nav.ts](./nav.ts)); the button would replay history.
 * A screen's arrow is one of two things, needing opposite help:
 *
 * - **An ancestor.** Only descending pushes, so it is normally right behind
 *   us and the browser's back already goes there. Only where the arrow skips a
 *   level (a screen opened from a shared link) is the press taken over.
 * - **A question**, on the four screens that would lose typed work: the press
 *   is *cancelled and nothing follows* — the dialog opens. Where the answer is
 *   already yes, the browser takes the press.
 *
 * **Ask before cancelling, and never navigate inside a cancelled press**: a
 * traversal there is measured against an index the browser already moved.
 * The takeover replaces this screen with the parent (`swap`) rather than
 * counting back, which is the same hazard by another door.
 *
 * Only *user*-initiated, cancellable traversals count; the app's own are left
 * alone (no loop), and a browser that won't cancel — no Navigation API (iOS
 * before 18.4), or no interaction to spend — keeps its own back.
 */
import { useEffect, useRef } from "react";
import { mark } from "./diag";
import { sameScreen, takeOwnTraversal } from "./nav";
import { note } from "./press-trace";

/** Only what's needed here; TypeScript's DOM lib has no Navigation API yet. */
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

/** What a screen's back arrow is, and so what the device's button must do. */
interface ScreenBack {
  /** Where the arrow climbs to, if it climbs. Absent: it is a plain back. */
  up?: string;
  /**
   * May we leave? `false` means it asked instead — so the press is cancelled
   * and the screen stays. Absent: yes, always.
   */
  mayLeave?: () => boolean;
  /**
   * Put `up` in this screen's place, for a press that has to be taken over. A
   * swap, never a count back: inside a cancelled press the browser thinks we are
   * already on the destination entry, so `history.go(-1)` would move two.
   */
  swap: (to: string) => void;
}

/**
 * A stack, because React mounts the screen you are going to before it unmounts
 * the one you are leaving: the newest registration is the one on screen.
 */
const screens: { current?: ScreenBack }[] = [];
let listening = false;

/**
 * Is this the device's back button? Pure, and exported for its test.
 */
export function isBackPress(
  e: {
    navigationType: string; userInitiated: boolean; cancelable: boolean;
    destination: { index: number };
  },
  here: number | undefined,
): boolean {
  if (!e.userInitiated || e.navigationType !== "traverse") return false;
  // A forward traversal is the redo of a back press, not a back press.
  if (here === undefined || e.destination.index >= here) return false;
  return e.cancelable;
}

/**
 * Every press, and what was done with it, in the flight recorder — whether
 * the event was cancelable and whether an interaction was left to spend are
 * gone by the time anyone asks (lib/diag.ts).
 */
function saw(e: NavigateEventLike, here: number | undefined, act: string): void {
  mark("back.press", `${act}  ${e.navigationType} to=${e.destination.index} here=${here}`
    + ` user=${e.userInitiated} cancelable=${e.cancelable}`
    + ` active=${navigator.userActivation?.isActive ?? "?"}`);
  // And inside whatever is open, beside the taps. A press the close watcher
  // takes reaches neither — it is the dialog's own `close event`.
  note(`back ${act}`);
}

function onNavigate(event: Event): void {
  const e = event as NavigateEventLike;
  // A push or a replace is the app moving itself, and neither the guard below
  // nor the recorder has anything to say about one. Only a traversal can be
  // the device's button.
  if (e.navigationType !== "traverse") return;
  const here = navigation()?.currentEntry?.index;
  // The screen on show, and only it: a screen that declares no back action
  // (the groups list, or one whose arrow is a plain back) keeps the browser's.
  // The app's own traversal first, whatever the event claims (`nav.ts`).
  if (takeOwnTraversal()) { saw(e, here, "ours"); return; }
  const back = screens[screens.length - 1]?.current;
  // Told apart in the log, because they are the two different ways a press
  // gets no guard at all: no screen asked for one, or the browser handed over
  // a press this cannot be spent on — the degradation ADR-0007 names.
  if (!back) { saw(e, here, "no screen"); return; }
  if (!isBackPress(e, here)) { saw(e, here, "not ours to take"); return; }
  // Asked and answered no: cancel, and let the dialog be the whole of it.
  if (back.mayLeave && !back.mayLeave()) { saw(e, here, "ASKED"); e.preventDefault(); return; }
  // The browser is already going where the arrow points — nearly every press.
  // Cancelling and re-navigating to the same place is the whole of what goes
  // wrong.
  const up = back.up;
  if (up === undefined || sameScreen(e.destination.url, up)) { saw(e, here, "let through"); return; }
  saw(e, here, "swap");
  e.preventDefault();
  // Out of the event's *task* before navigating again, not merely out of its
  // microtask checkpoint: a navigation started while the cancellation is still
  // unwinding is refused outright.
  setTimeout(() => back.swap(up), 0);
}

/**
 * While this screen is on show, the device's back button agrees with its back
 * arrow. `undefined` (no arrow, or a plain back) leaves it alone, so the app
 * can still be left.
 */
export function useBackButton(back: ScreenBack | undefined): void {
  const held = useRef(back);
  held.current = back;
  useEffect(() => {
    const screen = held;
    screens.push(screen);
    const nav = navigation();
    if (nav && !listening) {
      nav.addEventListener("navigate", onNavigate);
      listening = true;
    }
    return () => {
      const i = screens.indexOf(screen);
      if (i >= 0) screens.splice(i, 1);
    };
  }, []);
}
