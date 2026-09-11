import { describe, expect, it } from "vitest";
import { fitIndex } from "./fit";

describe("fitIndex", () => {
  it("takes the first that fits", () => {
    expect(fitIndex([300, 200, 100], 250)).toBe(1);
    expect(fitIndex([300, 200, 100], 300)).toBe(0);
    expect(fitIndex([300, 200, 100], 150)).toBe(2);
  });

  it("falls back to the leanest when nothing fits", () => {
    // Past the bottom rung it is the element's own ellipsis that copes.
    expect(fitIndex([300, 200, 100], 10)).toBe(2);
  });

  it("shows everything when the box has no width yet", () => {
    // Detached, hidden, prerendered: nothing will resize it back, so a narrow
    // guess would be permanent. Be optimistic instead.
    expect(fitIndex([300, 200, 100], 0)).toBe(0);
    expect(fitIndex([300, 200, 100], -1)).toBe(0);
  });

  it("survives a canvas that measures nothing", () => {
    // `textWidth` returns 0 where there is no canvas; 0 fits anything.
    expect(fitIndex([0, 0], 200)).toBe(0);
    expect(fitIndex([], 200)).toBe(0);
  });
});
