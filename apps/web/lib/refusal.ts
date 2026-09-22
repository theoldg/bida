"use client";

import { useState } from "react";

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
 * A refusal on one control, for a screen with one thing to refuse; forms with
 * several keep their own record (`app/g/entry/edit/page.tsx`).
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
