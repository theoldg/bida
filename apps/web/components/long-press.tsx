"use client";

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { tick } from "../lib/haptics";
import { RowMenu, type SheetAction } from "./row-menu";

/** iOS's own long-press default; Android's is 400–500ms. */
const HOLD_MS = 500;
/** A resting finger drifts. Past this it is a scroll, not a hold. */
const SLOP_PX = 10;
/**
 * How long after a hold's finger lifts its click may still arrive. Generous:
 * the guard also ends at the next press, so it cannot eat a real tap.
 */
const LIFT_CLICK_MS = 1000;

/**
 * Once a touch hold has been answered, the same finger has two more things to
 * say, and neither is meant: Android's own `contextmenu`, and the click as it
 * lifts. Both are hit-tested where the finger is — by then the menu's veil,
 * which closes on either, or for a hold that navigates, the next screen — so
 * they are caught on `document`, not on the held element. The guard ends at
 * that click, at the next press anywhere, or LIFT_CLICK_MS after the lift.
 * A keyboard's click (`detail === 0`) is never a finger.
 */
function guardHeldFinger() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const end = () => {
    clearTimeout(timer);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("contextmenu", swallow, true);
    document.removeEventListener("pointerdown", end, true);
  };
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onClick = (e: globalThis.MouseEvent) => {
    if (e.detail === 0) return;
    swallow(e);
    end();
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("contextmenu", swallow, true);
  document.addEventListener("pointerdown", end, true);
  return {
    lifted: () => { clearTimeout(timer); timer = setTimeout(end, LIFT_CLICK_MS); },
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
  const held = useRef<ReturnType<typeof guardHeldFinger> | null>(null);

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

  const lift = () => {
    disarm();
    held.current?.lifted();
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
        held.current = guardHeldFinger();
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
      if (start.current) held.current = guardHeldFinger();
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
