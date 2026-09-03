import { describe, expect, it } from "vitest";
import { takesOver } from "./back-button";

const press = (over: Partial<Parameters<typeof takesOver>[0]> = {}) => ({
  navigationType: "traverse", userInitiated: true, cancelable: true, destination: { index: 2 }, ...over,
});

describe("takesOver", () => {
  it("takes a back press on a screen that has its own back action", () => {
    expect(takesOver(press(), 3, true)).toBe(true);
  });

  it("leaves the browser's back alone where the screen has none", () => {
    expect(takesOver(press(), 3, false)).toBe(false);
  });

  // The arrow's own `history.go` is a traversal too; taking that one over
  // would call the arrow again, and again.
  it("leaves the app's own traversals alone", () => {
    expect(takesOver(press({ userInitiated: false }), 3, true)).toBe(false);
  });

  it("leaves pushes, replaces and forward traversals alone", () => {
    expect(takesOver(press({ navigationType: "push" }), 3, true)).toBe(false);
    expect(takesOver(press({ navigationType: "replace" }), 3, true)).toBe(false);
    expect(takesOver(press({ destination: { index: 4 } }), 3, true)).toBe(false);
  });

  it("gives way where the browser won't be cancelled", () => {
    expect(takesOver(press({ cancelable: false }), 3, true)).toBe(false);
    expect(takesOver(press(), undefined, true)).toBe(false);
  });
});
