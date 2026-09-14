import { describe, expect, it } from "vitest";
import { gapOf, reachOf } from "./viewport";

/** A phone with nothing covering it: the two viewports agree. */
const PHONE = { inner: 844, visible: 844, offset: 0, scale: 1, typing: false };

describe("what a gap between the two viewports means", () => {
  it("is nothing when they agree", () => {
    expect(gapOf(PHONE)).toEqual({ kb: 0, unexplained: 0 });
  });

  it("is the keyboard while something is being typed into", () => {
    expect(gapOf({ ...PHONE, visible: 528, typing: true })).toEqual({ kb: 316, unexplained: 0 });
  });

  it("counts the pan as covered too — iOS scrolls the visual viewport up", () => {
    expect(gapOf({ ...PHONE, visible: 528, offset: 40, typing: true }))
      .toEqual({ kb: 276, unexplained: 0 });
  });

  it("never pays a keyboard for a gap with nobody typing", () => {
    // The bug this exists for: a layout viewport taller than the screen, which
    // paid itself out as permanent padding at the foot of every list.
    expect(gapOf({ ...PHONE, visible: 797 })).toEqual({ kb: 0, unexplained: 47 });
  });

  it("ignores a pixel or two of toolbar settling, typing or not", () => {
    expect(gapOf({ ...PHONE, visible: 841 })).toEqual({ kb: 0, unexplained: 0 });
    expect(gapOf({ ...PHONE, visible: 841, typing: true })).toEqual({ kb: 0, unexplained: 0 });
  });

  it("blames a pinch for the gap it is, and pays nothing", () => {
    expect(gapOf({ ...PHONE, visible: 500, scale: 1.7, typing: true }))
      .toEqual({ kb: 0, unexplained: 0 });
  });

  it("reads a visible viewport taller than the layout one as no gap", () => {
    expect(gapOf({ ...PHONE, visible: 900 })).toEqual({ kb: 0, unexplained: 0 });
  });
});

describe("reachOf", () => {
  // A field parked 40px above where a scroll must stop, asking for the 104px
  // the act below it needs: 64px short.
  const FIELD = { bottom: 460, room: 104, stop: 500 };

  it("owes what the room under a field does not fit in", () => {
    expect(reachOf(FIELD)).toBe(64);
  });

  it("owes nothing for a field that asks for nothing", () => {
    expect(reachOf({ ...FIELD, room: 0 })).toBe(0);
  });

  it("owes nothing once the act below it clears the keys", () => {
    expect(reachOf({ ...FIELD, bottom: 396 })).toBe(0);
  });

  // The keyboard closing moves `stop` down the screen, and a field sitting
  // comfortably above it must stay where it is — not be re-hung at the bottom.
  it("never scrolls down to a field it is already past", () => {
    expect(reachOf({ ...FIELD, stop: 840 })).toBe(0);
  });
});
