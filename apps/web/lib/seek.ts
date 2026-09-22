/**
 * The DOM half of a refusal that has to travel before it flashes — the scroll
 * and the wait — beside the geometry in `lib/reveal.ts`. Shared by the
 * who-had-what grid and the entry form: a bloom spent mid-scroll is one nobody
 * sees, and the refused thing may be fixed by the time the scroll lands.
 *
 * **Never `scrollTo({ behavior: "smooth" })`** — iOS glides, Android jumps,
 * and no end event is reliable. Driving it frame by frame moves the same
 * everywhere and knows when it arrived.
 */

/** The shortest and longest a glide takes; distance decides in between. */
const MIN_MS = 240;
const MAX_MS = 480;

/** How long a glide over `distance` pixels takes. */
export function glideMs(distance: number): number {
  return Math.round(Math.min(MAX_MS, Math.max(MIN_MS, Math.abs(distance) * 0.6)));
}

/** Slow out, slow in: the same shape a native smooth scroll has on iOS. */
export function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < .5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/**
 * How far a scroller may sit from where a glide put it before that counts as
 * somebody else moving it: `scrollTop` rounds to device pixels on its own.
 */
const SLACK = 2;

/**
 * Scroll `box` to `target`, then call `done` once, on a later frame — never in
 * the same tick. A finger or wheel mid-way ends the glide and answers at once.
 * Returns a cancel that stops without answering, for a caller going away.
 * Under reduced motion the jump is instant and the answer still comes next
 * frame (`calmly`).
 */
export function glide(box: HTMLElement, target: number, done: () => void): () => void {
  const from = box.scrollTop;
  const distance = target - from;
  const still = calmly() || distance === 0;
  const duration = glideMs(distance);
  const start = Date.now();
  let last = from;
  let over = false;
  let frame = 0;

  const finish = (answer: boolean) => {
    if (over) return;
    over = true;
    cancelAnimationFrame(frame);
    box.removeEventListener("touchstart", takeOver);
    box.removeEventListener("wheel", takeOver);
    if (answer) done();
  };
  function takeOver() { finish(true); }

  const step = () => {
    if (over) return;
    // Moved by somebody else since the last frame — a drag the listeners
    // didn't see, the keyboard's own scroll: that is a take-over too.
    if (Math.abs(box.scrollTop - last) > SLACK) { finish(true); return; }
    const t = still ? 1 : (Date.now() - start) / duration;
    box.scrollTop = t >= 1 ? target : from + distance * ease(t);
    last = box.scrollTop;
    if (t >= 1) { finish(true); return; }
    frame = requestAnimationFrame(step);
  };

  box.addEventListener("touchstart", takeOver, { passive: true });
  box.addEventListener("wheel", takeOver, { passive: true });
  frame = requestAnimationFrame(step);
  return () => finish(false);
}

/**
 * Whether to travel at all. The flash is exempt from reduced motion (a colour
 * settling, globals.css), but scrolling is movement, so it becomes a jump.
 */
export const calmly = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
