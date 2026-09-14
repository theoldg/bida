import { describe, expect, it } from "vitest";
import { nearestOutOfView } from "./reveal";

const band = { top: 100, bottom: 400 };
const row = (top: number, height = 40) => ({ top, bottom: top + height });

describe("nearestOutOfView", () => {
  it("does not move when a row is in view", () => {
    expect(nearestOutOfView([row(20), row(200), row(900)], band)).toBeNull();
  });

  it("moves for a row the fold cuts, however little of it is missing", () => {
    expect(nearestOutOfView([row(70)], band)).toBe(-30);
    expect(nearestOutOfView([row(98)], band)).toBe(-2);
    expect(nearestOutOfView([row(362)], band)).toBe(2);
  });

  it("forgives a fraction of a pixel", () => {
    expect(nearestOutOfView([row(99.6)], band)).toBeNull();
  });

  it("scrolls up to a row above the fold, minimally", () => {
    expect(nearestOutOfView([row(-60)], band)).toBe(-160);
  });

  it("scrolls down to a row below the fold, minimally", () => {
    expect(nearestOutOfView([row(500)], band)).toBe(140);
  });

  it("takes the nearest of many, whichever side it is on", () => {
    expect(nearestOutOfView([row(-400), row(430), row(-90)], band)).toBe(70);
    expect(nearestOutOfView([row(-400), row(900), row(20)], band)).toBe(-80);
  });

  it("has nothing to say about an empty list", () => {
    expect(nearestOutOfView([], band)).toBeNull();
  });

  it("counts a row taller than the band as seen once it fills it", () => {
    expect(nearestOutOfView([row(50, 500)], band)).toBeNull();
  });
});
