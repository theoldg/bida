"use client";

import { useEffect, useRef, useState } from "react";
import { seekTarget } from "./reveal";
import { glide } from "./seek";

/**
 * A press that cannot go through, and the flash that answers it.
 *
 * Whatever stopped the press blooms `--debit` and settles back over ~600ms,
 * and the pressed control is spent for exactly that long, so a press that does
 * nothing still looks like it landed (docs/design-system.md).
 *
 * **`live` must come off when the flash ends** — a class left on is a button
 * greyed for good, and a `::placeholder` keeping ink it was lent (`globals.css`).
 *
 * `n` is the restart: a second refusal mid-flash wouldn't change the class
 * list, so parity picks between two identical animations to force a replay.
 * A React `key` would too, but remounts the <input> and loses caret, focus and
 * IME composition.
 */
export interface Refusal { n: number; live: boolean }

export const NOT_REFUSED: Refusal = { n: 0, live: false };

/** One more refusal on the same control: count it, and start the flash. */
export function refused(r: Refusal): Refusal {
  return { n: r.n + 1, live: true };
}

/**
 * Of the fields a refusal was aimed at, the ones still missing now. A refusal
 * that scrolls first lands when the scroll does, and a field fixed in between
 * must not bloom — it would spend Save for a problem that is gone.
 */
export function stillMissing<K extends string>(
  aimed: Partial<Record<K, boolean>>,
  missing: Partial<Record<K, boolean>>,
): Partial<Record<K, boolean>> {
  const out: Partial<Record<K, boolean>> = {};
  for (const k of Object.keys(aimed) as K[]) out[k] = !!aimed[k] && !!missing[k];
  return out;
}

/**
 * The flashes still running on fields that stopped being missing. The flash
 * can leave with its element, and an animation removed mid-flight never fires
 * `animationend`, so these have to be ended by hand or Save stays spent.
 */
export function staleFlashes<K extends string>(
  state: Record<K, Refusal>,
  missing: Partial<Record<K, boolean>>,
): K[] {
  return (Object.keys(state) as K[]).filter((k) => state[k].live && !missing[k]);
}

/**
 * The class that flashes a control red. Nothing unless a flash is actually
 * running — see `live` above.
 */
export function flashClass(r: Refusal): string {
  if (!r.live) return "";
  return r.n % 2 === 1 ? " flash-a" : " flash-b";
}

/**
 * A refusal on one control, for a screen with one thing to refuse; a form with
 * several takes `useRefusals`.
 *
 * `onFlashEnd` takes **nothing** when the fix arrives before the animation
 * ends (`components/name-adder.tsx`): the class comes off, no `animationend`
 * fires, and without the call the control stays spent forever.
 */
export function useRefusal(): {
  /** Hang on the control that blooms, with `onFlashEnd` beside it. */
  flash: string;
  /** A refusal is still on screen, so the control that was pressed is spent. */
  live: boolean;
  refuse: () => void;
  /** The flash is over — because it ran out, or because the fix landed. */
  onFlashEnd: (e?: React.AnimationEvent) => void;
} {
  const [state, setState] = useState<Refusal>(NOT_REFUSED);
  return {
    flash: flashClass(state),
    live: state.live,
    refuse: () => setState(refused),
    // Only the control's own animation counts: a `pseudoElement` event from
    // elsewhere would end a flash still running. No event at all is the fix
    // arriving early, and always counts.
    onFlashEnd: (e) => {
      if (e?.pseudoElement) return;
      setState((r) => ({ ...r, live: false }));
    },
  };
}

/**
 * Refusals on several controls at once, for a form whose Save can point at
 * more than one (`app/g/entry/edit/page.tsx`). Each control carries
 * `data-refuse="<key>"` inside the page's `.scroll`, with `flash(key)` on its
 * class and `onFlashEnd(key)` beside it.
 *
 * `missing` is what is missing as of this render. With the keyboard up the
 * form is a strip of a few rows, and a flash out of view is a press that did
 * nothing, so unless a refused control is wholly in view the nearest is
 * scrolled to — and it blooms off what is *still* missing when the scroll
 * lands: a field fixed mid-scroll has nothing to bloom.
 */
export function useRefusals<K extends string>(missing: Record<K, boolean>): {
  flash: (key: K) => string;
  onFlashEnd: (key: K) => (e: React.AnimationEvent) => void;
  /** A refusal is on screen or being scrolled to, so the pressed control is spent. */
  spent: boolean;
  refuse: (aimed: Partial<Record<K, boolean>>) => void;
} {
  const keys = Object.keys(missing) as K[];
  const [state, setState] = useState(
    () => Object.fromEntries(keys.map((k) => [k, NOT_REFUSED])) as Record<K, Refusal>,
  );
  const [seeking, setSeeking] = useState(false);
  const missingNow = useRef(missing);
  missingNow.current = missing;

  // A flash whose field stopped being missing ends here, by hand — see
  // `staleFlashes`.
  useEffect(() => {
    const stale = staleFlashes(state, missingNow.current);
    if (stale.length === 0) return;
    setState((r) => {
      const next = { ...r };
      for (const k of stale) next[k] = { ...r[k], live: false };
      return next;
    });
  });

  const bloom = (aimed: Partial<Record<K, boolean>>) =>
    setState((r) => {
      const next = { ...r };
      for (const k of keys) if (aimed[k]) next[k] = refused(r[k]);
      return next;
    });

  return {
    flash: (key) => flashClass(state[key]),
    // Only the control's own animation counts — the placeholder is a
    // pseudo-element on the same clock.
    onFlashEnd: (key) => (e) => {
      if (e.pseudoElement) return;
      setState((r) => ({ ...r, [key]: { ...r[key], live: false } }));
    },
    spent: seeking || keys.some((k) => state[k].live),
    refuse: (aimed) => {
      // One journey at a time: a second press mid-scroll would start another.
      if (seeking) return;
      const box = document.querySelector<HTMLElement>(".scroll");
      if (!box) { bloom(aimed); return; }
      const targets = keys.flatMap((k) => {
        const el = aimed[k] ? box.querySelector(`[data-refuse="${k}"]`) : null;
        return el ? [el] : [];
      });
      // The band a control can be read in: the scroller less its scroll
      // padding, which at the bottom is the keyboard it is drawn over (`--kb`).
      const view = box.getBoundingClientRect();
      const pad = getComputedStyle(box);
      const target = seekTarget(box, targets, {
        top: view.top + (parseFloat(pad.scrollPaddingTop) || 0),
        bottom: view.bottom - (parseFloat(pad.scrollPaddingBottom) || 0),
      });
      if (target === null) { bloom(aimed); return; }
      setSeeking(true);
      glide(box, target, () => {
        setSeeking(false);
        bloom(stillMissing(aimed, missingNow.current));
      });
    },
  };
}
