"use client";

import { useEffect, useRef, useState } from "react";
import { seekTarget } from "./reveal";
import { glide } from "./seek";

/**
 * A press that cannot go through: whatever stopped it flashes red, and the
 * pressed control is spent for as long (docs/design-system.md). `live` must
 * come off when the flash ends, or the button stays greyed for good.
 *
 * `n`'s parity picks between two identical animations to replay a second
 * refusal mid-flash. A React `key` would remount the <input> and lose the caret.
 */
export interface Refusal { n: number; live: boolean }

export const NOT_REFUSED: Refusal = { n: 0, live: false };

export function refused(r: Refusal): Refusal {
  return { n: r.n + 1, live: true };
}

/** A field fixed while the refusal scrolled to it must not bloom. */
export function stillMissing<K extends string>(
  aimed: Partial<Record<K, boolean>>,
  missing: Partial<Record<K, boolean>>,
): Partial<Record<K, boolean>> {
  const out: Partial<Record<K, boolean>> = {};
  for (const k of Object.keys(aimed) as K[]) out[k] = !!aimed[k] && !!missing[k];
  return out;
}

/** An animation removed mid-flight never fires `animationend`, so these end by hand. */
export function staleFlashes<K extends string>(
  state: Record<K, Refusal>,
  missing: Partial<Record<K, boolean>>,
): K[] {
  return (Object.keys(state) as K[]).filter((k) => state[k].live && !missing[k]);
}

export function flashClass(r: Refusal): string {
  if (!r.live) return "";
  return r.n % 2 === 1 ? " flash-a" : " flash-b";
}

/**
 * One control; a form with several takes `useRefusals`. Call `onFlashEnd()`
 * with nothing when the fix arrives before the animation ends.
 */
export function useRefusal(): {
  flash: string;
  /** The pressed control is spent. */
  live: boolean;
  refuse: () => void;
  onFlashEnd: (e?: React.AnimationEvent) => void;
} {
  const [state, setState] = useState<Refusal>(NOT_REFUSED);
  return {
    flash: flashClass(state),
    live: state.live,
    refuse: () => setState(refused),
    // Not the placeholder's animation, which runs on the same clock.
    onFlashEnd: (e) => {
      if (e?.pseudoElement) return;
      setState((r) => ({ ...r, live: false }));
    },
  };
}

/**
 * Each control carries `data-refuse="<key>"` inside the page's `.scroll`. A
 * flash out of view is a press that did nothing, so unless a refused control
 * is wholly in view the nearest is scrolled to first.
 */
export function useRefusals<K extends string>(missing: Record<K, boolean>): {
  flash: (key: K) => string;
  onFlashEnd: (key: K) => (e: React.AnimationEvent) => void;
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
    // Not the placeholder's animation, which runs on the same clock.
    onFlashEnd: (key) => (e) => {
      if (e.pseudoElement) return;
      setState((r) => ({ ...r, [key]: { ...r[key], live: false } }));
    },
    spent: seeking || keys.some((k) => state[k].live),
    refuse: (aimed) => {
      if (seeking) return;
      const box = document.querySelector<HTMLElement>(".scroll");
      if (!box) { bloom(aimed); return; }
      const targets = keys.flatMap((k) => {
        const el = aimed[k] ? box.querySelector(`[data-refuse="${k}"]`) : null;
        return el ? [el] : [];
      });
      // Less the scroll padding, which at the bottom is the keyboard.
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
