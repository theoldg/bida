/**
 * The DOM half of a refusal that has to travel before it flashes — the scroll
 * and the wait for it — beside the geometry in `lib/reveal.ts`, which decides
 * whether to go and how far. Shared by the who-had-what grid and the entry
 * form, which both learned the same two things: a bloom spent while the rows
 * are still moving is a bloom nobody saw, and whatever was refused may have
 * been fixed by the time the scroll lands.
 */

/**
 * How long a scroll is waited on before the flash runs anyway. A smooth scroll
 * has no end event every browser here agrees on, and a person who has taken the
 * list over mid-travel is owed an answer more than a tidy one.
 */
const SETTLED_MS = 800;

/** The scroller has arrived — or has been given long enough to. */
export function whenStill(box: Element, target: number, done: () => void) {
  const giveUp = Date.now() + SETTLED_MS;
  const look = () => {
    if (Math.abs(box.scrollTop - target) <= 1 || Date.now() > giveUp) { done(); return; }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

/**
 * Whether to travel at all. The flash itself is exempt from reduced motion —
 * a colour settling is what that guidance asks for (globals.css) — but this is
 * movement, and movement is exactly what it asks to be spared: the row is put
 * in place at once instead.
 */
export const calmly = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
