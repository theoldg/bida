import { useLayoutEffect, useRef, useState } from "react";
import { revealWhole, scrollTarget } from "./reveal";
import { calmly, glide, glideMs } from "./seek";

/**
 * A fold that moves its scroller rather than the reader's place: opened, it
 * glides until all of it shows (the top winning when it can't, `revealWhole`);
 * closed, it glides back to where it was opened from — or, opened without
 * moving, just down to where the shorter list can still sit. Never a jump:
 * the height the close took away is held as padding under the list until the
 * glide lands, since a scroller past its new end would otherwise snap there
 * the frame the rows went.
 *
 * The dock under a short list (`.whodock`, Edit or Save) rides its foot, so
 * any height the fold changes moves it too: it slides there rather than
 * landing in one frame, on the glide's own clock.
 *
 * Moves only on a press: a fold drawn open (`startOpen`) leaves the list be.
 * `ref` goes on the whole fold — its button and what it opens.
 */
export function useFold<T extends HTMLElement>(startOpen = false) {
  const [open, setOpen] = useState(startOpen);
  const ref = useRef<T>(null);
  const pressed = useRef<{ top: number; height: number; dock: number | null } | null>(null);
  // The opening glide, so the close knows where to return to.
  const trip = useRef<{ from: number; to: number } | null>(null);

  function toggle() {
    const box = ref.current?.closest<HTMLElement>(".scroll");
    if (box && ref.current) {
      pressed.current = { top: box.scrollTop, height: ref.current.offsetHeight, dock: dockTop(box) };
    }
    setOpen((was) => !was);
  }

  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.closest<HTMLElement>(".scroll");
    const press = pressed.current;
    pressed.current = null;
    if (!el || !box || !press) return;

    if (open) {
      const view = box.getBoundingClientRect();
      const { top, bottom } = el.getBoundingClientRect();
      const to = scrollTarget(box, revealWhole({ top, bottom }, { top: view.top, bottom: view.bottom }));
      slideDock(box, press.dock);
      trip.current = to === box.scrollTop ? null : { from: box.scrollTop, to };
      return trip.current ? glide(box, to, () => {}) : undefined;
    }

    const lost = Math.max(0, press.height - el.offsetHeight);
    const pad = box.style.paddingBottom;
    box.style.paddingBottom = `${parseFloat(getComputedStyle(box).paddingBottom) + lost}px`;
    box.scrollTop = press.top;
    const end = Math.max(0, box.scrollHeight - lost - box.clientHeight);
    // Back to before the opening glide, unless the list was moved since.
    const back = trip.current && Math.abs(press.top - trip.current.to) <= 2 ? trip.current.from : press.top;
    trip.current = null;
    const target = Math.max(0, Math.min(back, end));
    // The padding held the list's height, so the dock moves only once it goes.
    const settle = () => {
      const dock = dockTop(box);
      box.style.paddingBottom = pad;
      slideDock(box, dock);
    };
    if (target === box.scrollTop) { settle(); return; }
    const stop = glide(box, target, settle);
    return () => { stop(); settle(); };
  }, [open]);

  return { open, toggle, ref };
}

/** The dock riding this scroller's foot, if it has one. */
function dockOf(box: HTMLElement): HTMLElement | null {
  const next = box.nextElementSibling;
  return next instanceof HTMLElement && next.classList.contains("whodock") ? next : null;
}

function dockTop(box: HTMLElement): number | null {
  return dockOf(box)?.getBoundingClientRect().top ?? null;
}

/** From where the dock was drawn to where it now is, as a transform. */
function slideDock(box: HTMLElement, from: number | null) {
  const dock = dockOf(box);
  if (!dock || from === null || calmly()) return;
  const by = from - dock.getBoundingClientRect().top;
  if (Math.abs(by) < 1) return;
  dock.animate([{ transform: `translateY(${by}px)` }, { transform: "none" }],
    { duration: glideMs(by), easing: "cubic-bezier(.2, 0, 0, 1)" });
}
