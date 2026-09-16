import { describe, expect, it } from "vitest";
import { nearestOutOfView, revealWhole, scrollTarget } from "./reveal";

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

describe("revealWhole", () => {
  it("leaves a box that is already all in view alone", () => {
    expect(revealWhole({ top: 150, bottom: 300 }, band)).toBe(0);
    expect(revealWhole({ top: 100, bottom: 400 }, band)).toBe(0);
  });

  it("brings a box up from below by the least that shows the end of it", () => {
    expect(revealWhole({ top: 300, bottom: 450 }, band)).toBe(50);
  });

  it("brings a box down from above by the least that shows the start of it", () => {
    expect(revealWhole({ top: 40, bottom: 190 }, band)).toBe(-60);
  });

  it("starts a box too tall to fit at its top, wherever it is", () => {
    expect(revealWhole({ top: 200, bottom: 800 }, band)).toBe(100);
    expect(revealWhole({ top: -50, bottom: 550 }, band)).toBe(-150);
  });

  it("forgives a fraction of a pixel", () => {
    expect(revealWhole({ top: 99.6, bottom: 400.4 }, band)).toBe(0);
  });
});

describe("scrollTarget", () => {
  const box = (scrollTop: number) => ({ scrollTop, scrollHeight: 1000, clientHeight: 400 });

  it("is where the scroll goes when the list has room for it", () => {
    expect(scrollTarget(box(100), 250)).toBe(350);
    expect(scrollTarget(box(300), -120)).toBe(180);
  });

  it("stops at the foot of the list, not past it", () => {
    expect(scrollTarget(box(500), 300)).toBe(600);
  });

  it("stops at the head of the list, not above it", () => {
    expect(scrollTarget(box(80), -300)).toBe(0);
  });

  it("stays at the top of a list too short to scroll", () => {
    expect(scrollTarget({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 }, 200)).toBe(0);
  });
});
