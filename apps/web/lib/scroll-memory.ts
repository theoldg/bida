"use client";

import { useEffect, type RefObject } from "react";

/**
 * Where you were on each screen, for as long as the app is open.
 *
 * The app scrolls inside a div — `.scroll` in `components/chrome.tsx`, one per
 * screen — and not the document, so the browser's own restoration, which knows
 * only about the document, restored nothing: open the fortieth entry in a
 * ledger, come back, and you are at the top of the list with the row you were
 * just reading somewhere below the fold.
 *
 * Held in memory rather than in `sessionStorage`. A reload refolds the whole
 * app out of Dexie anyway, and an offset into a list that is about to be
 * rebuilt is not worth persisting — nor worth a `try` around a storage call
 * that can refuse.
 */

const positions = new Map<string, number>();

/**
 * A screen is a route ([ADR-0007](../../../docs/decisions/0007-a-screen-is-a-route.md)),
 * so the route is the key — the query included, since `?id=` is which group
 * and `?tab=` is which of a group's two lists. Read once when a `.scroll`
 * mounts: each one belongs to a single screen, and the two tabs are different
 * components, so a tab switch is a fresh mount with a key of its own.
 */
function scrollKey(): string {
  return `${location.pathname}${location.search}`;
}

export function rememberScroll(key: string, top: number): void {
  positions.set(key, top);
}

export function recallScroll(key: string): number {
  return positions.get(key) ?? 0;
}

/** Test seam. Nothing in the app forgets a position; there is little to forget. */
export function forgetScrolls(): void {
  positions.clear();
}

/**
 * One attempt at putting a screen back where it was, against the height the
 * content has reached so far.
 *
 * A list comes out of Dexie after its frame draws, so at the moment of restore
 * there is usually nothing to scroll yet. Aiming at the furthest point that
 * exists, and staying unfinished until the real one does, walks the screen down
 * as the rows arrive instead of jumping it once they have all landed — and it
 * settles at the closest reachable place when the list is genuinely shorter
 * than it was, which is what a deleted entry leaves behind.
 */
export function restoreStep(target: number, maxTop: number): { top: number; done: boolean } {
  if (maxTop >= target) return { top: target, done: true };
  return { top: Math.max(maxTop, 0), done: false };
}

/** How long the content has to arrive before the screen stays where it got to. */
const RESTORE_WINDOW_MS = 1200;

/**
 * Remember this scroller's position, and put it back on the way in.
 *
 * **Nothing is recorded while a restore is in flight.** The positions passed
 * through on the way to the target are all shorter than it, and recording one
 * would overwrite the target with it — the list would creep towards the top
 * every time you came back to it. Recording starts when the restore lands, when
 * the person takes the scroll over, or when the window closes: whichever is
 * first.
 */
export function useScrollMemory(ref: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const key = scrollKey();
    const target = recallScroll(key);

    let recording = target === 0;
    let frame = 0;

    function settle() {
      recording = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }

    if (!recording) {
      const deadline = performance.now() + RESTORE_WINDOW_MS;
      const step = () => {
        const { top, done } = restoreStep(target, el.scrollHeight - el.clientHeight);
        el.scrollTop = top;
        if (done || performance.now() >= deadline) settle();
        else frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }

    const onScroll = () => { if (recording) rememberScroll(key, el.scrollTop); };
    el.addEventListener("scroll", onScroll, { passive: true });
    // A finger on the list outranks a restore that hasn't finished: whatever
    // the content does next, the screen is theirs from here.
    el.addEventListener("pointerdown", settle, { passive: true });
    el.addEventListener("wheel", settle, { passive: true });

    return () => {
      settle();
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("pointerdown", settle);
      el.removeEventListener("wheel", settle);
    };
  }, [ref]);
}
