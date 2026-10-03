"use client";

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { clickGuard } from "../lib/click-guard";
import { tick } from "../lib/haptics";
import { RowMenu, type SheetAction } from "./row-menu";

/** iOS's own long-press default; Android's is 400–500ms. */
const HOLD_MS = 500;
/** Before the hold, past this is a scroll; after it, a reach for the menu. */
const SLOP_PX = 10;
/**
 * The finger still down once a touch hold is answered. Its next move is the
 * hand reaching for the menu, so the browser's scroll is refused and the item
 * under the finger at the lift is chosen, as with a phone's own long-press
 * menus. Android's `contextmenu` and the lift's click outlive the finger, so
 * they are `clickGuard`'s.
 */
function heldFinger(from: { x: number; y: number } | null) {
  let hot: Element | null = null;

  // A finger that never moved picked nothing.
  const itemAt = (at: { clientX: number; clientY: number }) =>
    from && Math.hypot(at.clientX - from.x, at.clientY - from.y) > SLOP_PX
      ? document.elementFromPoint(at.clientX, at.clientY)?.closest(".rowmenu-item") ?? null
      : null;

  // Or a sliding finger reaches "Delete" with nothing saying which item it is
  // over. On the node: no re-render per item crossed.
  const highlight = (item: Element | null) => {
    if (item === hot) return;
    hot?.classList.remove("rowmenu-hot");
    item?.classList.add("rowmenu-hot");
    hot = item;
  };

  const keep = (e: TouchEvent) => { if (e.cancelable) e.preventDefault(); };
  const onMove = (e: globalThis.PointerEvent) => highlight(itemAt(e));
  const release = () => {
    highlight(null);
    document.removeEventListener("touchmove", keep, { capture: true });
    document.removeEventListener("pointermove", onMove, true);
  };
  // Not passive, or `preventDefault` is ignored.
  document.addEventListener("touchmove", keep, { passive: false, capture: true });
  document.addEventListener("pointermove", onMove, true);
  // Ends with the guard, so nothing holds the scroller off after it.
  const guard = clickGuard(release);

  return {
    /** `at` is absent when the gesture was taken away. A real click, so a slide and a tap share the handler. */
    lifted: (at?: { clientX: number; clientY: number }) => {
      const item = at ? itemAt(at) : null;
      release();
      guard.expire();
      if (item instanceof HTMLElement) item.click();
    },
  };
}

/**
 * Handlers that call `onHold` on a touch hold or a right click; `null` leaves
 * the press ordinary. iOS never sends `contextmenu` for a touch, so the hold is
 * timed from pointer events; Android sends both, and the first to land wins.
 */
export function useHold(onHold: ((el: HTMLElement) => void) | null) {
  const latest = useRef(onHold);
  latest.current = onHold;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ id: number; x: number; y: number } | null>(null);
  const held = useRef<ReturnType<typeof heldFinger> | null>(null);
  /** Marked `data-holding`, so its wash builds over `HOLD_MS`: a hold is seen coming. */
  const pressed = useRef<HTMLElement | null>(null);

  const disarm = () => {
    clearTimeout(timer.current);
    start.current = null;
    delete pressed.current?.dataset.holding;
    pressed.current = null;
  };
  // A row can leave mid-hold (the one that opens /diag navigates), and the lift never reaches it.
  useEffect(() => () => { disarm(); held.current?.lifted(); }, []);

  const fire = (el: HTMLElement) => {
    disarm();
    if (!latest.current || !el.isConnected) return;
    // The finger hides the menu's arrival: the tick is what says the hold landed.
    tick();
    latest.current(el);
  };

  // `pointercancel` (a second finger, an edge swipe) says nothing about where the finger was going.
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
      pressed.current = el;
      el.dataset.holding = "";
      timer.current = setTimeout(() => {
        // Before `fire` disarms: a later slide is measured from here.
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
      // Android's, beating the timer, comes with its finger still down; a mouse's doesn't.
      if (start.current) held.current = heldFinger(start.current);
      fire(e.currentTarget);
    },
  };
}

/**
 * A menu of actions on a long press or right click; spread `hold` on the row.
 * The row is marked `data-held` while its menu is open, so it lifts out of the
 * list behind it. `asking` keeps it lifted while a question an item opened is
 * up: "Delete this expense?" is about that row.
 */
export function useLongPressMenu(actions: SheetAction[], asking = false) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const handlers = useHold(actions.length === 0 ? null : (el) => setAnchor(el.getBoundingClientRect()));
  return {
    hold: { ...handlers, "data-held": anchor || asking ? "" : undefined },
    menu: anchor
      ? <RowMenu anchor={anchor} actions={actions} onClose={() => setAnchor(null)} />
      : null,
  };
}
