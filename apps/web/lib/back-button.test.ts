import { describe, expect, it } from "vitest";
import { takesOver } from "./back-button";

const press = (over: Partial<Parameters<typeof takesOver>[0]> = {}) => ({
  navigationType: "traverse", userInitiated: true, cancelable: true,
  destination: { index: 2, url: "https://h.app/g/history?id=g1" }, ...over,
});

/** A screen whose arrow climbs somewhere the press below it is not going. */
const upTo = (href: string) => ({ run: () => {}, href });
const asks = { run: () => {} };

describe("takesOver", () => {
  it("takes a back press the browser would answer with the wrong screen", () => {
    expect(takesOver(press(), 3, upTo("/g?id=g1"))).toBe(true);
  });

  it("takes one on a screen whose back is a question, wherever it leads", () => {
    expect(takesOver(press(), 3, asks)).toBe(true);
  });

  it("leaves the browser's back alone where the screen has none", () => {
    expect(takesOver(press(), 3, undefined)).toBe(false);
  });

  // The one that matters most, because it is nearly every press: a screen
  // opened from its parent has that parent one entry behind it, so the
  // browser's own back is already the arrow. Cancelling it is the risk.
  it("leaves a press already headed for the parent alone", () => {
    expect(takesOver(press(), 3, upTo("/g/history?id=g1"))).toBe(false);
  });

  it("compares screens, not strings: query order and a trailing slash don't count", () => {
    const at = (url: string) => press({ destination: { index: 2, url } });
    expect(takesOver(at("https://h.app/g/history/?id=g1"), 3, upTo("/g/history?id=g1"))).toBe(false);
    expect(takesOver(at("https://h.app/g?id=g1&tab=balances"), 3, upTo("/g?tab=balances&id=g1"))).toBe(false);
    // A tab is part of the screen's name: the ledger is not the balances tab.
    expect(takesOver(at("https://h.app/g?id=g1&tab=balances"), 3, upTo("/g?id=g1"))).toBe(true);
  });

  // The arrow's own traversal is a traversal too; taking that one over would
  // call the arrow again, and again.
  it("leaves the app's own traversals alone", () => {
    expect(takesOver(press({ userInitiated: false }), 3, asks)).toBe(false);
  });

  it("leaves pushes, replaces and forward traversals alone", () => {
    expect(takesOver(press({ navigationType: "push" }), 3, asks)).toBe(false);
    expect(takesOver(press({ navigationType: "replace" }), 3, asks)).toBe(false);
    expect(takesOver(press({ destination: { index: 4, url: "https://h.app/" } }), 3, asks)).toBe(false);
  });

  it("gives way where the browser won't be cancelled", () => {
    expect(takesOver(press({ cancelable: false }), 3, asks)).toBe(false);
    expect(takesOver(press(), undefined, asks)).toBe(false);
  });
});
