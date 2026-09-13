import { describe, expect, it } from "vitest";
import { gapOf } from "./viewport";

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
