import { describe, expect, it } from "vitest";
import type { LedgerItem } from "./ledger-motion";
import {
  COAST_MS, indexAt, landingOf, offsetsOf, rangeOf, segmentsOf, speedOf, windowAround,
} from "./ledger-window";

const H = { row: 69, day: 30 };
/** A day line, then `perDay` rows, `days` times. */
function ledger(days: number, perDay: number): LedgerItem<string>[] {
  const out: LedgerItem<string>[] = [];
  for (let d = 0; d < days; d++) {
    out.push({ key: `day:${d}`, kind: "day", label: `Day ${d}` });
    for (let r = 0; r < perDay; r++) out.push({ key: `${d}-${r}`, kind: "row", row: `${d}-${r}` });
  }
  return out;
}

describe("where each slot sits", () => {
  it("sums the heights, so the scroller is whole before anything is drawn", () => {
    const offsets = offsetsOf(ledger(2, 3), H);
    expect(offsets).toEqual([0, 30, 99, 168, 237, 267, 336, 405, 474]);
  });

  it("finds the slot under a point, and clamps to the list", () => {
    const offsets = offsetsOf(ledger(2, 3), H);
    expect(indexAt(offsets, 0)).toBe(0);
    expect(indexAt(offsets, 29)).toBe(0);
    expect(indexAt(offsets, 30)).toBe(1);
    expect(indexAt(offsets, 300)).toBe(5);
    expect(indexAt(offsets, -50)).toBe(0);
    expect(indexAt(offsets, 9999)).toBe(7);
    expect(indexAt([0], 10)).toBe(0);
  });

  it("takes every slot any part of which shows", () => {
    const offsets = offsetsOf(ledger(2, 3), H);
    expect(rangeOf(offsets, 0, 100)).toEqual([0, 3]);
    expect(rangeOf(offsets, 99, 168)).toEqual([2, 3]);
    expect(rangeOf(offsets, 100, 1000)).toEqual([2, 8]);
    expect(rangeOf(offsets, 2000, 3000)).toEqual([0, 0]);
    expect(rangeOf([0], 0, 100)).toEqual([0, 0]);
  });
});

describe("the window of rows drawn", () => {
  const rowsIn = (items: LedgerItem<string>[], [a, b]: [number, number]) =>
    items.slice(a, b).filter((i) => i.kind === "row").length;

  it("holds as many rows as asked, centred, with the date lines among them", () => {
    const items = ledger(10, 5);
    const w = windowAround(items, 30, 12);
    expect(rowsIn(items, w)).toBe(12);
    expect(w[0]).toBeLessThanOrEqual(30);
    expect(w[1]).toBeGreaterThan(30);
    expect(Math.abs((30 - w[0]) - (w[1] - 30))).toBeLessThanOrEqual(3);
  });

  it("slides inside the list at either end rather than coming up short", () => {
    const items = ledger(10, 5);
    expect(rowsIn(items, windowAround(items, 0, 12))).toBe(12);
    expect(windowAround(items, 0, 12)[0]).toBe(0);
    expect(rowsIn(items, windowAround(items, items.length - 1, 12))).toBe(12);
    expect(windowAround(items, items.length - 1, 12)[1]).toBe(items.length);
  });

  it("is the whole list when the list is short", () => {
    const items = ledger(1, 4);
    expect(windowAround(items, 2, 12)).toEqual([0, 5]);
    expect(windowAround([], 0, 12)).toEqual([0, 0]);
  });
});

describe("guessing where a fling lands", () => {
  it("reads speed off the samples kept", () => {
    expect(speedOf([{ t: 0, y: 0 }, { t: 50, y: 100 }, { t: 100, y: 300 }])).toBe(3);
    expect(speedOf([{ t: 0, y: 0 }])).toBe(0);
  });

  it("lands a coast's length on, clamped to the scroller", () => {
    expect(landingOf(1000, 4, 800, 100_000)).toBe(1000 + 4 * COAST_MS);
    expect(landingOf(1000, -4, 800, 100_000)).toBe(0);
    expect(landingOf(1000, 40, 800, 5000)).toBe(5000);
  });

  it("guesses nothing for a scroll of under a screen", () => {
    expect(landingOf(1000, 1, 800, 100_000)).toBeNull();
    expect(landingOf(1000, 0, 800, 100_000)).toBeNull();
  });
});

describe("what is drawn and what is left as height", () => {
  it("folds each undrawn run into one gap of its own height", () => {
    const offsets = offsetsOf(ledger(2, 3), H);
    const drawn = new Set([2, 3, 7]);
    expect(segmentsOf(offsets, (i) => drawn.has(i))).toEqual([
      { gap: 99, first: 0 }, { at: 2 }, { at: 3 }, { gap: 168, first: 4 }, { at: 7 },
    ]);
  });

  it("is all slots or one gap at the extremes", () => {
    const offsets = offsetsOf(ledger(1, 2), H);
    expect(segmentsOf(offsets, () => true)).toEqual([{ at: 0 }, { at: 1 }, { at: 2 }]);
    expect(segmentsOf(offsets, () => false)).toEqual([{ gap: 168, first: 0 }]);
  });
});
