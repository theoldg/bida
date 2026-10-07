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
 * any height the fold changes moves it too: `slidingDock` slides it there,
 * once the held padding goes.
 *
 * Moves only on a press: a fold drawn open (`startOpen`) leaves the list be.
 * `ref` goes on the whole fold — its button and what it opens.
 */
export function useFold<T extends HTMLElement>(startOpen = false) {
  const [open, setOpen] = useState(startOpen);
  const ref = useRef<T>(null);
  const pressed = useRef<{ top: number; height: number } | null>(null);
  // The opening glide, so the close knows where to return to.
  const trip = useRef<{ from: number; to: number } | null>(null);

  function toggle() {
    const box = ref.current?.closest<HTMLElement>(".scroll");
    if (box && ref.current) {
      pressed.current = { top: box.scrollTop, height: ref.current.offsetHeight };
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
    const settle = () => { box.style.paddingBottom = pad; };
    if (target === box.scrollTop) { settle(); return; }
    const stop = glide(box, target, settle);
    return () => { stop(); settle(); };
  }, [open]);

  return { open, toggle, ref };
}

/** Drawn `by` px from where layout put it, gliding home on the fold's clock. */
function slide(el: HTMLElement, by: number) {
  if (Math.abs(by) < 1) return;
  el.getAnimations().forEach((a) => a.cancel());
  el.animate([{ transform: `translateY(${by}px)` }, { transform: "none" }],
    { duration: glideMs(by), easing: "cubic-bezier(.2, 0, 0, 1)" });
}

/** How far a running `slide` has the element from its place right now. */
function drawnOff(el: HTMLElement): number {
  const t = getComputedStyle(el).transform;
  return t && t !== "none" ? new DOMMatrixReadOnly(t).m42 : 0;
}

/** What moves the dock without the form changing: the keyboard, the window. */
function viewportKey(): string {
  const kb = document.documentElement.style.getPropertyValue("--kb");
  return `${innerHeight}|${visualViewport?.height ?? ""}|${kb}`;
}

/**
 * The entry screen's dock (`.whodock`) never jumps: a fold opening or closing
 * above it slides it. Whenever the list or the dock changes size, the dock and
 * its last child (the button) are drawn where they were and glide to where
 * they now are: the dock by how far its top moved, the button by whatever more
 * it moved inside it. The entry form doesn't use it: nothing folds there, and
 * Save sliding after a tab or a refusal read as lag.
 *
 * Only size changes move it, so scrolling never does; and a change of the
 * viewport (the keyboard, a rotation) is re-measured, not slid — iOS moves the
 * page for the keyboard already.
 *
 * A ref callback, not a hook: `<div className="whodock" ref={slidingDock}>`.
 * It starts with the dock, which a screen may draw only once its data lands.
 */
export function slidingDock(dock: HTMLElement | null): (() => void) | undefined {
  const box = dock?.previousElementSibling;
  if (!dock || !(box instanceof HTMLElement)) return;
  // Where layout last put each, with any running slide taken out.
  let was: { key: string; dock: number; button: number } | null = null;

  const measure = () => {
    const button = dock.lastElementChild instanceof HTMLElement ? dock.lastElementChild : null;
    const dockOff = drawnOff(dock);
    const buttonOff = button ? drawnOff(button) : 0;
    const top = dock.getBoundingClientRect().top;
    const now = {
      key: viewportKey(),
      dock: top - dockOff,
      // Inside the dock, so the dock's own slide is in both and cancels.
      button: button ? button.getBoundingClientRect().top - top - buttonOff : 0,
    };
    if (was && was.key === now.key && !calmly()) {
      // From where each is drawn now, which mid-slide is not where it was laid out.
      slide(dock, was.dock + dockOff - now.dock);
      if (button) slide(button, was.button + buttonOff - now.button);
    }
    was = now;
  };

  const watch = new ResizeObserver(measure);
  watch.observe(dock);
  watch.observe(box);
  for (const child of box.children) watch.observe(child);
  // Whatever the list draws once its data lands; watch whichever are there.
  const children = new MutationObserver(() => {
    for (const child of box.children) watch.observe(child);
    measure();
  });
  children.observe(box, { childList: true });
  return () => { watch.disconnect(); children.disconnect(); };
}
