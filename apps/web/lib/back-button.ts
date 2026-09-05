/**
 * The device's back button, doing what the screen's back arrow does.
 *
 * The two used to disagree. The arrow goes *up* — it names a parent and
 * unwinds to it ([nav.ts](./nav.ts)) — while the button replayed wherever you
 * had been, so the two parted company wherever the arrow skipped a level; and
 * on the entry form the arrow asked before throwing a typed draft away and the
 * button just threw it away.
 *
 * So the button runs the screen's own back action instead, whatever that
 * action is — up-link, `router.back()`, or a question. One behaviour, defined
 * once per screen, in `TopBar`.
 *
 * **It takes the press over only when it has to.** A screen reached from its
 * parent — the ledger from the groups list, an entry from the ledger — already
 * has that parent one entry behind it, so the browser's own back *is* the
 * arrow. Those presses are left alone: nothing is cancelled, so nothing can be
 * mistimed, and the press spends none of the one-per-interaction activation a
 * cancellation costs. What is left to take over is where the two genuinely
 * differ — an arrow that skips a level, such as the whole group's feed reached
 * from one entry's own history, and a form that asks before losing a draft. An
 * entry opened from beside itself is no longer one of them: it names the screen
 * it came from ([group-link.ts](./group-link.ts)), which is where the press was
 * going anyway.
 *
 * Only *user*-initiated traversals are taken; the app's own traversal (the
 * arrow, mid-flight) is left alone, which is what keeps this from looping. And
 * only cancellable ones: a browser that refuses — no Navigation API at all
 * (iOS before 18.4), or no recent interaction to spend — keeps its own back,
 * which is no worse than what this replaced.
 */
import { useEffect, useRef } from "react";
import { sameScreen } from "./nav";

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

/**
 * What a screen's back arrow does, and — when it is an up-link — where it
 * lands. The destination is what lets a press the browser is already getting
 * right go through untouched.
 */
export interface ScreenBack {
  run: () => void;
  href?: string;
}

/**
 * A stack, because React mounts the screen you are going to before it unmounts
 * the one you are leaving: the newest registration is the one on screen.
 */
const screens: { current?: ScreenBack }[] = [];
let listening = false;

/**
 * Is this navigation a back press the browser would get wrong? Pure, and
 * exported for its test: reading the event and the current index is the
 * caller's.
 */
export function takesOver(
  e: {
    navigationType: string; userInitiated: boolean; cancelable: boolean;
    destination: { index: number; url: string };
  },
  here: number | undefined,
  back: ScreenBack | undefined,
): boolean {
  if (!back || !e.userInitiated || e.navigationType !== "traverse") return false;
  // A forward traversal is the redo of a back press, not a back press.
  if (here === undefined || e.destination.index >= here) return false;
  // The browser is already going where the arrow points. Leaving it is not a
  // shortcut: cancelling and re-navigating to the screen the press was headed
  // for anyway is the whole of what used to go wrong, and it is the path
  // nearly every press in the app takes.
  if (back.href !== undefined && sameScreen(e.destination.url, back.href)) return false;
  return e.cancelable;
}

function onNavigate(event: Event): void {
  const e = event as NavigateEventLike;
  // The screen on show, and only it: a screen that declares no back action
  // (the groups list, or one whose arrow is a plain back) keeps the browser's.
  const back = screens[screens.length - 1]?.current;
  if (!takesOver(e, navigation()?.currentEntry?.index, back) || !back) return;
  e.preventDefault();
  // Out of the event's *task* before navigating again, not merely out of its
  // microtask checkpoint: a traversal started while the cancellation is still
  // unwinding is refused outright. `goUp` no longer *depends* on the timing —
  // it names its destination rather than counting to it — but there is no
  // reason to hand the browser a window in which it will say no.
  setTimeout(back.run, 0);
}

/**
 * While this screen is on show, the device's back button runs `back` instead of
 * its own navigation. `undefined` — a screen with no back arrow, such as the
 * groups list — leaves the button alone, so the app can still be left.
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
