"use client";

import { useState } from "react";

/**
 * A press that cannot go through, and the flash that answers it.
 *
 * A refusal points rather than explains: whatever stopped the press blooms
 * `--debit` and settles back over ~600ms, and the control that was pressed is
 * spent for exactly that long — a press that does nothing has to look like it
 * landed (docs/design-system.md). The shape of it
 * is two numbers, and both are load-bearing.
 *
 * `live` is the one that is easy to leave out. A `::placeholder` is not
 * rendered while the field has text, so typing into a refused field and
 * emptying it again *creates the pseudo-element afresh* — and a fresh
 * pseudo-element starts any animation still declared on it. The class has to
 * come off when the flash ends, not sit there waiting to be replayed.
 *
 * `n` is the restart. A second refusal while the first is still running would
 * change nothing in the class list, so the browser would not replay it; the
 * parity picks between two identical animations, which changes
 * `animation-name` and guarantees it does. (A React `key` would restart it
 * too, by remounting the <input> and taking the caret, the focus and any IME
 * composition with it.)
 */
export interface Refusal { n: number; live: boolean }

export const NOT_REFUSED: Refusal = { n: 0, live: false };

/** One more refusal on the same control: count it, and start the flash. */
export function refused(r: Refusal): Refusal {
  return { n: r.n + 1, live: true };
}

/**
 * Of the fields a refusal was aimed at, the ones still missing now. A refusal
 * that scrolls first is aimed when Save is pressed and lands when the scroll
 * does, and a field fixed in between has nothing left to bloom — a flash on it
 * would spend Save for a problem that is gone.
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
 * A refusal on one control, for a screen with only one thing to refuse. A
 * form with several fields to bloom keeps its own record of them instead
 * (`app/g/entry/edit/page.tsx`).
 *
 * `onFlashEnd` takes the animation's own event, and takes **nothing** when the
 * fix arrives before the animation does — a keystroke in the add row ends its
 * flash on the spot (`components/name-adder.tsx`). Something has to say so:
 * the class comes off with the refusal, so no `animationend` ever fires for a
 * flash that was cut short, and a control spent for the length of one would
 * stay spent forever.
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
    // Only the control's own animation counts: a placeholder is a
    // pseudo-element on the same clock, and `pseudoElement` is how an
    // animation event says which of the two it is. No event at all is the fix
    // arriving early, and that always counts.
    onFlashEnd: (e) => {
      if (e?.pseudoElement) return;
      setState((r) => ({ ...r, live: false }));
    },
  };
}
