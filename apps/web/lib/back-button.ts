/**
 * The device's back button, doing what the screen's back arrow does.
 *
 * The two used to disagree. The arrow goes *up* — it names a parent and
 * unwinds to it ([nav.ts](./nav.ts)) — while the button replayed wherever you
 * had been, so the two parted company wherever the arrow skipped a level; and
 * on the entry form the arrow asked before throwing a typed draft away and the
 * button just threw it away.
 *
 * A screen says what its back arrow is, and this makes the button agree. There
 * are only two things it can be, and they need opposite help:
 *
 * - **An ancestor.** Because only descending pushes, that ancestor is normally
 *   the entry right behind us and the browser's own back already goes there:
 *   nothing to do. It is only when the arrow skips a level — a screen opened
 *   from a shared link, so the parent was never visited — that the press has to
 *   be taken over and `goUp` run instead.
 * - **A question**, on the four screens that would lose typed work. Here back
 *   is not a navigation at all, so the press is *cancelled and nothing
 *   follows*: the dialog opens and the screen stays put. If the answer is
 *   already yes — nothing typed — the press is left alone and the browser
 *   takes it back, which is where the arrow was going anyway.
 *
 * That second case used to cancel the press and then navigate again in its
 * place, which is what made this hard: a traversal begun inside a cancelled one
 * is measured against an index the browser has already moved, and it was the
 * busiest path in the app — every press on those four screens, typed or not.
 * Asking *before* cancelling removes it. What is left re-navigates only where
 * there is genuinely nowhere for the press to go on its own, and does it by
 * putting the parent in this screen's place (`swap`) rather than counting back
 * over entries — which is the same hazard by the other door.
 *
 * Only *user*-initiated traversals are considered; the app's own traversal (the
 * arrow, mid-flight) is left alone, which is what keeps this from looping. And
 * only cancellable ones: a browser that refuses — no Navigation API at all
 * (iOS before 18.4), or no recent interaction to spend — keeps its own back,
 * which is no worse than what this replaced.
 */
import { useEffect, useRef } from "react";
import { sameScreen, takeOwnTraversal } from "./nav";

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
export interface ScreenBack {
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

function onNavigate(event: Event): void {
  const e = event as NavigateEventLike;
  // The screen on show, and only it: a screen that declares no back action
  // (the groups list, or one whose arrow is a plain back) keeps the browser's.
  // The app's own traversal first, whatever the event claims (`nav.ts`).
  if (e.navigationType === "traverse" && takeOwnTraversal()) return;
  const back = screens[screens.length - 1]?.current;
  if (!back || !isBackPress(e, navigation()?.currentEntry?.index)) return;
  // Asked and answered no: cancel, and let the dialog be the whole of it.
  if (back.mayLeave && !back.mayLeave()) { e.preventDefault(); return; }
  // The browser is already going where the arrow points — which, with only
  // descending pushing, is nearly every press in the app. Leaving it alone is
  // not a shortcut: cancelling and re-navigating to the screen the press was
  // headed for anyway is the whole of what used to go wrong.
  const up = back.up;
  if (up === undefined || sameScreen(e.destination.url, up)) return;
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
