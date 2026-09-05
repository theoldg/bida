import { describe, expect, it } from "vitest";
import { isBackPress } from "./back-button";

const press = (over: Partial<Parameters<typeof isBackPress>[0]> = {}) => ({
  navigationType: "traverse", userInitiated: true, cancelable: true,
  destination: { index: 2 }, ...over,
});

describe("isBackPress", () => {
  it("knows the device's back button", () => {
    expect(isBackPress(press(), 3)).toBe(true);
  });

  // The arrow's own traversal is a traversal too; taking that one over would
  // call the arrow again, and again.
  it("leaves the app's own traversals alone", () => {
    expect(isBackPress(press({ userInitiated: false }), 3)).toBe(false);
  });

  it("leaves pushes, replaces and forward traversals alone", () => {
    expect(isBackPress(press({ navigationType: "push" }), 3)).toBe(false);
    expect(isBackPress(press({ navigationType: "replace" }), 3)).toBe(false);
    // A forward traversal is the redo of a back press, not a back press.
    expect(isBackPress(press({ destination: { index: 4 } }), 3)).toBe(false);
  });

  it("gives way where the browser won't be cancelled", () => {
    expect(isBackPress(press({ cancelable: false }), 3)).toBe(false);
    expect(isBackPress(press(), undefined)).toBe(false);
  });
});
