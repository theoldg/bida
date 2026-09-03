/**
 * The device's back button, doing what the screen's back arrow does.
 *
 * The two used to disagree. The arrow goes *up* — it names a parent and
 * unwinds to it ([nav.ts](./nav.ts)) — while the button replayed wherever you
 * had been, so an entry opened from the history feed went back to the feed
 * while its arrow went up to the group; and on the entry form the arrow asked
 * before throwing a typed draft away and the button just threw it away.
 *
 * So the button no longer navigates on its own: a user-initiated backward
 * traversal is cancelled and the screen's own back action runs instead,
 * whatever that action is — up-link, `router.back()`, or a question. One
 * behaviour, defined once per screen, in `TopBar`.
 *
 * Only *user*-initiated traversals are taken; the app's own `history.go` (the
 * arrow, mid-flight) is left alone, which is what keeps this from looping. And
 * only cancellable ones: a browser that refuses — no Navigation API at all
 * (iOS before 18.4), or no recent interaction to spend — keeps its own back,
 * which is no worse than what this replaced.
 */
import { useEffect, useRef } from "react";

/** Only what's needed here; TypeScript's DOM lib has no Navigation API yet. */
type NavigateEventLike = Event & {
  navigationType: string;
  userInitiated: boolean;
  destination: { index: number };
};
type NavigationLike = EventTarget & { currentEntry: { index: number } | null };

function navigation(): NavigationLike | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { navigation?: NavigationLike }).navigation;
}

/**
 * A stack, because React mounts the screen you are going to before it unmounts
 * the one you are leaving: the newest registration is the one on screen.
 */
const screens: { current?: () => void }[] = [];
let listening = false;

/**
 * Is this navigation the back button, pressed by a person, on a screen that
 * has somewhere of its own to go? Pure, and exported for its test: reading the
 * event and the current index is the caller's.
 */
export function takesOver(
  e: { navigationType: string; userInitiated: boolean; cancelable: boolean; destination: { index: number } },
  here: number | undefined,
  hasBack: boolean,
): boolean {
  if (!hasBack || !e.userInitiated || e.navigationType !== "traverse") return false;
  // A forward traversal is the redo of a back press, not a back press.
  if (here === undefined || e.destination.index >= here) return false;
  return e.cancelable;
}

function onNavigate(event: Event): void {
  const e = event as NavigateEventLike;
  // The screen on show, and only it: a screen that declares no back action
  // (the groups list, or one whose arrow is a plain back) keeps the browser's.
  const back = screens[screens.length - 1]?.current;
  if (!takesOver(e, navigation()?.currentEntry?.index, !!back) || !back) return;
  e.preventDefault();
  // Out of the event before navigating again: cancelling a traversal and
  // starting another one inside the same handler is asking for trouble.
  queueMicrotask(back);
}

/**
 * While this screen is on show, the device's back button runs `back` instead of
 * its own navigation. `undefined` — a screen with no back arrow, such as the
 * groups list — leaves the button alone, so the app can still be left.
 */
export function useBackButton(back: (() => void) | undefined): void {
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
