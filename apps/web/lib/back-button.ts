/**
 * The device's back button, doing what the screen's back arrow does.
 *
 * The arrow goes *up* — it names a parent and unwinds to it
 * ([nav.ts](./nav.ts)) — where the button would replay wherever you had been.
 * A screen says what its back arrow is, and this makes the button agree. There
 * are only two things it can be, and they need opposite help:
 *
 * - **An ancestor.** Because only descending pushes, that ancestor is normally
 *   the entry right behind us and the browser's back already goes there. Only
 *   where the arrow skips a level — a screen opened from a shared link, so the
 *   parent was never visited — is the press taken over and `goUp` run.
 * - **A question**, on the four screens that would lose typed work. Back is
 *   not a navigation at all there, so the press is *cancelled and nothing
 *   follows*: the dialog opens, the screen stays. Where the answer is already
 *   yes, the press is left alone and the browser takes it back.
 *
 * **Ask before cancelling, and never navigate inside a cancelled press.** A
 * traversal begun inside one is measured against an index the browser has
 * already moved — and that is the busiest path in the app, every press on
 * those four screens. What re-navigation is left runs only where the press has
 * nowhere to go on its own, and does it by putting the parent in this screen's
 * place (`swap`) rather than counting back over entries, which is the same
 * hazard by the other door.
 *
 * Only *user*-initiated traversals count; the app's own (the arrow, mid-flight)
 * is left alone, which is what keeps this from looping. And only cancellable
 * ones: a browser that refuses — no Navigation API (iOS before 18.4), or no
 * recent interaction to spend — keeps its own back.
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
   * Put `up` in this screen's place, for the press that has to be taken over.
   *
   * A swap, never a count back: this runs inside a press the app has just
   * cancelled, where the browser's idea of where we are is the entry the press
   * was heading for and `history.go(-1)` would move two. It is also the right
   * move on its own terms — the takeover happens only where going back would
   * not land on the parent.
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
 * Is this the device's back button? Pure, and exported for its test: reading
 * the event and the current index is the caller's.
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
 * Every press, and what was done with it, in the flight recorder.
 *
 * This path cannot be watched with a cable: it is a thumb on a system button
 * in an installed app, and what decides the outcome — whether the browser made
 * the event cancelable, whether the document still had an interaction to spend
 * — is gone by the time anyone asks. One line each says which of them it was
 * (lib/diag.ts).
 */
function saw(e: NavigateEventLike, here: number | undefined, act: string): void {
  mark("back.press", `${act}  ${e.navigationType} to=${e.destination.index} here=${here}`
    + ` user=${e.userInitiated} cancelable=${e.cancelable}`
    + ` active=${navigator.userActivation?.isActive ?? "?"}`);
  // And again inside whatever is open over the screen, where it belongs beside
  // the taps rather than in a timeline the reader has to align by hand. A press
  // the close watcher takes reaches neither — it is the `close event` the
  // dialog notes for itself (components/dialog.tsx).
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
  // The browser is already going where the arrow points — with only
  // descending pushing, nearly every press in the app. Leaving it alone is not
  // a shortcut: cancelling and re-navigating to the screen the press was
  // headed for anyway is the whole of what goes wrong.
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
 * arrow. `undefined` — a screen with no arrow, such as the groups list, or one
 * whose arrow is already a plain back — leaves the button alone, so the app can
 * still be left.
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
