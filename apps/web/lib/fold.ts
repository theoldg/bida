import { useLayoutEffect, useRef, useState, type RefObject } from "react";
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
  slide(dock, from - dock.getBoundingClientRect().top);
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
 * The fold's slide for a dock whose form changes under it with no press to
 * measure from — a refusal said over Save, a helper line opening in the split.
 * Whenever the form or the dock changes size, the dock and its last child (the
 * button) are drawn where they were and glide to where they now are: the dock
 * by how far its top moved, the button by whatever more it moved inside it, so
 * a line opening over Save is uncovered by the button sliding off it.
 *
 * Only size changes move it, so scrolling never does; and a change of the
 * viewport (the keyboard, a rotation) is re-measured, not slid — iOS moves the
 * page for the keyboard already. `ref` goes on the `.whodock`.
 */
export function useDockSlide(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const dock = ref.current;
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
    // The form's sections come and go with its kind; watch whichever are there.
    const children = new MutationObserver(() => {
      for (const child of box.children) watch.observe(child);
      measure();
    });
    children.observe(box, { childList: true });
    return () => { watch.disconnect(); children.disconnect(); };
  }, [ref]);
}
