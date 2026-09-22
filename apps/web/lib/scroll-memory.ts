"use client";

import { useEffect, type RefObject } from "react";

/**
 * Where you were on each screen, for as long as the app is open.
 *
 * The app scrolls inside a div (`.scroll`, components/chrome.tsx), not the
 * document, so the browser's own restoration restores nothing.
 *
 * In memory, not `sessionStorage`: a reload refolds everything from Dexie, and
 * an offset into a list about to be rebuilt isn't worth persisting.
 */

const positions = new Map<string, number>();

/**
 * The route is the key ([ADR-0007](../../../docs/decisions/0007-a-screen-is-a-route.md)),
 * query included — `?id=` is the group, `?tab=` which list. Read once on
 * mount; the two tabs are different components, so each gets its own key.
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
 * One attempt at restoring a position against the height reached so far.
 * A list arrives from Dexie after its first frame, so aim at the furthest
 * point that exists and stay unfinished until the real one does: the screen
 * walks down as rows land, and settles at the closest reachable place if the
 * list got shorter.
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
 * **Nothing is recorded while a restore is in flight** — the positions passed
 * on the way are shorter than the target, and the list would creep up every
 * visit. Recording starts when the restore lands, the person scrolls, or the
 * window closes, whichever is first.
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
