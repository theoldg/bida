"use client";

import { useLayoutEffect, type RefObject } from "react";
import { returnTo } from "./nav";

/**
 * Where each group's ledger was left, put back only on a way back to it
 * (`markReturn`, lib/nav.ts): the back arrow or button, and Save, Delete or
 * Discard on a screen opened from it. A tap into the group or a launch
 * reopening it opens at the top.
 *
 * **The row at the top edge, not an offset**: an entry saved, deleted or
 * synced above it moves every offset under it by a row, and the ledger would
 * come back a row off. So the position is that row and how far it sat above
 * the edge, to the pixel; a raw offset is kept for the head of the list, where
 * no row reaches the edge, and for a row that has since gone.
 *
 * In memory: a reload is a launch, which opens at the top anyway.
 */
export interface LedgerPosition {
  /** The scroller's own `scrollTop` when it was left. */
  top: number;
  /** The entry whose row crossed the top edge, if one did. */
  entry: string | null;
  /** That row's top against the scroller's, in px: zero or less. */
  offset: number;
}

/** A row as `placeOf` needs it: its entry, and its edges against the viewport. */
export interface RowBox { entry: string; top: number; bottom: number }

/**
 * The position of a scroller whose top edge is at `edge`, given its rows in
 * order. Pure, and exported for its test.
 */
export function placeOf(top: number, edge: number, rows: RowBox[]): LedgerPosition {
  const row = rows.find((r) => r.bottom > edge);
  return row && row.top <= edge
    ? { top, entry: row.entry, offset: row.top - edge }
    : { top, entry: null, offset: 0 };
}

/**
 * The `scrollTop` that puts `pos` back: the anchor row at its offset if it is
 * still drawn (`rowTop`, against the viewport), otherwise the raw offset.
 */
export function aimFor(pos: LedgerPosition, scrollTop: number, edge: number, rowTop: number | undefined): number {
  return rowTop === undefined ? pos.top : scrollTop + (rowTop - edge) - pos.offset;
}

const positions = new Map<string, LedgerPosition>();
/** Ends the restore in flight, if one is: see `yieldPosition`. */
let restoring: (() => void) | null = null;

/**
 * Stop putting the ledger back, for something that means to move it next —
 * a saved row being brought into view (components/ledger-rows.tsx). Its
 * glide would otherwise be undone each frame for the rest of the window.
 */
export function yieldPosition(): void {
  restoring?.();
}
/** The last return a ledger has spent: each puts one back, once. */
let spent: number | null = null;

/** Keep going while what is above the rows is still arriving (cards, banners). */
const RESTORE_WINDOW_MS = 1200;

function rowsOf(box: HTMLElement): RowBox[] {
  return [...box.querySelectorAll<HTMLElement>("[data-entry]")].map((el) => {
    const r = el.getBoundingClientRect();
    return { entry: el.dataset.entry!, top: r.top, bottom: r.bottom };
  });
}

/**
 * Record this ledger's position as it scrolls, and put the recorded one back
 * when the screen was reached by going back. A layout effect, so the first
 * frame painted is already in place — under the veil, if one is up.
 */
export function useLedgerPosition(ref: RefObject<HTMLDivElement | null>, groupId: string): void {
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const arrival = returnTo(location.href);
    const saved = positions.get(groupId);
    // The same arrival seen twice is the effect run again (StrictMode, or the
    // group's id settling), with the scroller already where the first put it.
    const again = arrival !== null && arrival === spent;
    const restore = arrival !== null && !again && saved !== undefined && saved.top > 0;
    if (arrival !== null) spent = arrival;
    if (!restore && !again) positions.delete(groupId);

    const record = () => {
      const edge = box.getBoundingClientRect().top;
      positions.set(groupId, placeOf(box.scrollTop, edge, rowsOf(box)));
    };

    // Nothing is recorded while a restore is in flight: its scrolls are ours.
    let recording = !restore;
    let frame = 0;
    const settle = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (restoring === settle) restoring = null;
      if (!recording) { recording = true; record(); }
    };
    if (again) record();

    if (restore) {
      const apply = () => {
        const edge = box.getBoundingClientRect().top;
        const row = saved.entry
          ? box.querySelector<HTMLElement>(`[data-entry="${CSS.escape(saved.entry)}"]`) : null;
        box.scrollTop = aimFor(saved, box.scrollTop, edge, row?.getBoundingClientRect().top);
      };
      apply();
      restoring = settle;
      // The cards above the rows come from their own reads and can land a frame
      // or two later, pushing the rows down; follow them until they stop.
      const deadline = performance.now() + RESTORE_WINDOW_MS;
      const step = () => {
        apply();
        if (performance.now() >= deadline) settle();
        else frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }

    let pending = 0;
    const onScroll = () => {
      if (!recording || pending) return;
      pending = requestAnimationFrame(() => { pending = 0; record(); });
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    // A finger on the list outranks a restore that hasn't finished.
    const hands = ["pointerdown", "wheel", "touchstart", "keydown"] as const;
    for (const h of hands) box.addEventListener(h, settle, { passive: true });

    return () => {
      if (restoring === settle) restoring = null;
      if (frame) cancelAnimationFrame(frame);
      if (pending) cancelAnimationFrame(pending);
      box.removeEventListener("scroll", onScroll);
      for (const h of hands) box.removeEventListener(h, settle);
    };
  }, [ref, groupId]);
}
