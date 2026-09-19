"use client";

import { guarding, note } from "./menu-trace";

/**
 * How long after the finger is gone a click it caused may still arrive.
 * Generous: the guard also ends at the next press, so it cannot eat a real tap.
 */
export const CLICK_WAIT_MS = 1000;

/**
 * Swallow the leftover click a touch gesture has already been answered for.
 *
 * A gesture that acts before the click — a hold that opens a menu, a menu item
 * that answers the lift itself (`components/row-menu.tsx`) — has consumed the
 * press, but the browser still sends the click, hit-tested wherever the finger
 * ended up: the menu's veil, the row underneath, the screen just navigated to.
 * So **it is caught on `document`, not on any one element**, and it outlives
 * the finger by design.
 *
 * Ends at the click, at the next press anywhere, or `CLICK_WAIT_MS` after
 * `expire`. A click with `detail === 0` is never a finger — it is a keyboard's,
 * or one the app dispatched itself — and goes through untouched. `also` runs
 * at the end too, for the half of a gesture that has to stop with this one.
 */
export function clickGuard(also?: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** `end` is reached more than one way; the recorder is told once. */
  let over = false;

  const swallow = (e: Event) => {
    note(`swallow ${e.type}`);
    e.preventDefault();
    e.stopPropagation();
  };
  const end = () => {
    if (over) return;
    over = true;
    guarding(false);
    clearTimeout(timer);
    also?.();
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("contextmenu", swallow, true);
    document.removeEventListener("pointerdown", end, true);
  };
  const onClick = (e: MouseEvent) => {
    if (e.detail === 0) return;
    swallow(e);
    end();
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("contextmenu", swallow, true);
  document.addEventListener("pointerdown", end, true);
  guarding(true);

  return {
    /** The finger is gone; only what it has already caused is still due. */
    expire: () => { clearTimeout(timer); timer = setTimeout(end, CLICK_WAIT_MS); },
    end,
  };
}
