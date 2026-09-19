"use client";

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { tick } from "../lib/haptics";
import { guarding, note } from "../lib/menu-trace";
import { RowMenu, type SheetAction } from "./row-menu";

/** iOS's own long-press default; Android's is 400–500ms. */
const HOLD_MS = 500;
/**
 * A resting finger drifts. Past this it is a scroll, not a hold — and, once
 * the hold has been answered, past this it is a reach for the menu.
 */
const SLOP_PX = 10;
/**
 * How long after a hold's finger lifts its click may still arrive. Generous:
 * the guard also ends at the next press, so it cannot eat a real tap.
 */
const LIFT_CLICK_MS = 1000;

/**
 * Once a touch hold has been answered, the finger that is still down owns the
 * rest of the gesture — and three things want it.
 *
 * The browser wants to read its next movement as a scroll: pans are allowed
 * everywhere (`touch-action` on `html, body`), so sliding off the row hands
 * the touch to the scroller, which fires `pointercancel` and dispatches no
 * click at all. But that movement is the hand reaching for the menu the hold
 * has just opened — a menu you can slide onto without lifting is how a phone's
 * own long-press menus work, and the finger tries it whether or not we are
 * listening. So the scroll is refused and the item under the finger when it
 * lifts is the one chosen. It has to have travelled `SLOP_PX` to choose one:
 * the card is only a few px clear of the row, and a finger that never moved
 * did not pick anything.
 *
 * The other two are leftovers the press is not asking for: Android's own
 * `contextmenu`, and the click as the finger lifts. Both are hit-tested where
 * the finger is — by then the menu's veil, which closes on either, or for a
 * hold that navigates, the next screen — so they are caught on `document`, not
 * on the held element. That half ends at the click, at the next press
 * anywhere, or LIFT_CLICK_MS after the lift, and it outlives the finger by
 * design: a click can arrive after the lift, but nothing may still be holding
 * the scroller off by then. A click with `detail === 0` is never a finger —
 * that is a keyboard's, or the one this makes itself to choose an item.
 */
function heldFinger(from: { x: number; y: number } | null) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hot: Element | null = null;
  /** `end` is reached more than one way; the recorder is told once. */
  let over = false;

  /** The menu item under the finger, once it has moved far enough to mean it. */
  const itemAt = (at: { clientX: number; clientY: number }) =>
    from && Math.hypot(at.clientX - from.x, at.clientY - from.y) > SLOP_PX
      ? document.elementFromPoint(at.clientX, at.clientY)?.closest(".rowmenu-item") ?? null
      : null;

  // The sliding finger gets the same wash a tapped one does, or it arrives at
  // "Delete" with nothing having said which row it is over. Set on the node
  // rather than through React: the menu does not re-render while a finger is
  // crossing it, and this is already the part of the press that is hand-wired.
  const warm = (item: Element | null) => {
    if (item === hot) return;
    hot?.classList.remove("rowmenu-hot");
    item?.classList.add("rowmenu-hot");
    hot = item;
  };

  const keep = (e: TouchEvent) => { if (e.cancelable) e.preventDefault(); };
  const onMove = (e: globalThis.PointerEvent) => warm(itemAt(e));
  const swallow = (e: Event) => {
    note(`swallow ${e.type}`);
    e.preventDefault();
    e.stopPropagation();
  };
  /** The finger is gone; only the events it has already caused are still due. */
  const release = () => {
    warm(null);
    document.removeEventListener("touchmove", keep, { capture: true });
    document.removeEventListener("pointermove", onMove, true);
  };
  const end = () => {
    if (!over) { over = true; guarding(false); }
    clearTimeout(timer);
    release();
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("contextmenu", swallow, true);
    document.removeEventListener("pointerdown", end, true);
  };
  const onClick = (e: globalThis.MouseEvent) => {
    if (e.detail === 0) return;
    swallow(e);
    end();
  };
  // Not passive, or `preventDefault` is ignored and the scroller takes the
  // touch anyway — the one listener here that has to say so out loud.
  document.addEventListener("touchmove", keep, { passive: false, capture: true });
  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("contextmenu", swallow, true);
  document.addEventListener("pointerdown", end, true);
  guarding(true);
  return {
    /**
     * The finger has lifted at `at`, or been taken away (no point). Choosing
     * is a real click on the item, so the menu answers a slide and a tap
     * through the same handler.
     */
    lifted: (at?: { clientX: number; clientY: number }) => {
      const item = at ? itemAt(at) : null;
      release();
      clearTimeout(timer);
      timer = setTimeout(end, LIFT_CLICK_MS);
      if (item instanceof HTMLElement) item.click();
    },
  };
}

/**
 * Handlers that call `onHold` on a touch hold or a right click; spread them on
 * the element. `onHold` null means nothing to offer, and the press stays an
 * ordinary one.
 *
 * A right click is a `contextmenu` event, and so is a touch hold on Android —
 * but **iOS never sends `contextmenu` for a touch**, in any browser, so a
 * touch hold is timed here from pointer events. Android then has both, so a
 * press answers once: whichever lands first, the other is swallowed. A scroll
 * taking the touch over is `pointercancel`; a second finger is a pinch.
 *
 * `NoLongPress` (components/no-long-press.tsx) swallows `contextmenu`
 * everywhere; `stopPropagation` keeps it off a press answered here.
 */
export function useHold(onHold: ((el: HTMLElement) => void) | null) {
  // The latest `onHold`, read when the timer fires rather than when it was set.
  const latest = useRef(onHold);
  latest.current = onHold;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ id: number; x: number; y: number } | null>(null);
  /** This press has been answered by a hold, and its finger is still down. */
  const held = useRef<ReturnType<typeof heldFinger> | null>(null);

  const disarm = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  // A row can leave mid-hold — the hold that opens /diag navigates — and its
  // finger's lift then never reaches it.
  useEffect(() => () => { disarm(); held.current?.lifted(); }, []);

  const fire = (el: HTMLElement) => {
    disarm();
    if (!latest.current || !el.isConnected) return;
    // The one press in the app with no wash under it — the finger is still
    // down and the menu opens above it, so the tick is what says the hold
    // landed (lib/haptics.ts).
    tick();
    latest.current(el);
  };

  // Only a lift chooses: `pointercancel` is the gesture being taken away —
  // a second finger, a system edge swipe — and says nothing about where the
  // first one was going.
  const lift = (e?: PointerEvent<HTMLElement>) => {
    disarm();
    held.current?.lifted(e?.type === "pointerup" ? e : undefined);
    held.current = null;
  };

  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (!e.isPrimary) { disarm(); return; }
      held.current = null;
      disarm();
      if (!latest.current || e.pointerType === "mouse") return;
      const el = e.currentTarget;
      start.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        // Read before `fire`, which disarms: where the hold landed is what a
        // later slide is measured against.
        held.current = heldFinger(start.current);
        fire(el);
      }, HOLD_MS);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const s = start.current;
      if (s && s.id === e.pointerId && Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLOP_PX) {
        disarm();
      }
    },
    onPointerUp: lift,
    onPointerCancel: lift,
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      if (!latest.current) return;
      e.preventDefault();
      e.stopPropagation();
      // A touch's `contextmenu` (Android, when it beats the timer) comes with
      // its finger still down and its click still to come; a mouse's with
      // neither. A touch's arriving after the timer never gets here.
      if (start.current) held.current = heldFinger(start.current);
      fire(e.currentTarget);
    },
  };
}

/**
 * Opens a small menu of actions on a long press or a right click (`useHold`).
 * Spread `hold` on the row.
 *
 * What is remembered is the row, not the point pressed: `RowMenu` opens in the
 * same place for a given row however it was reached.
 */
export function useLongPressMenu(actions: SheetAction[]) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const hold = useHold(actions.length === 0 ? null : (el) => setAnchor(el.getBoundingClientRect()));
  return {
    hold,
    menu: anchor
      ? <RowMenu anchor={anchor} actions={actions} onClose={() => setAnchor(null)} />
      : null,
  };
}
