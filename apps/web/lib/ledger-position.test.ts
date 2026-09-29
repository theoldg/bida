import { describe, expect, it } from "vitest";
import { aimFor, placeOf } from "./ledger-position";
import { markReturn, returnTo } from "./nav";

// A scroller whose top edge sits 60px down the viewport (under the top bar).
const EDGE = 60;
const rows = [
  { entry: "a", top: 20, bottom: 84 },
  { entry: "b", top: 84, bottom: 148 },
  { entry: "c", top: 148, bottom: 212 },
];

describe("placeOf", () => {
  it("anchors on the row crossing the top edge, to the pixel", () => {
    expect(placeOf(500, EDGE, rows)).toEqual({ top: 500, entry: "a", offset: -40 });
  });

  it("skips a row wholly above the edge", () => {
    const above = [{ entry: "a", top: -50, bottom: 14 }, { entry: "b", top: 14, bottom: 78 }];
    expect(placeOf(500, EDGE, above)).toEqual({ top: 500, entry: "b", offset: -46 });
  });

  it("takes a row exactly at the edge", () => {
    expect(placeOf(300, EDGE, [{ entry: "a", top: EDGE, bottom: EDGE + 64 }]))
      .toEqual({ top: 300, entry: "a", offset: 0 });
  });

  it("keeps only the offset in the list's head, where no row reaches the edge", () => {
    expect(placeOf(30, EDGE, [{ entry: "a", top: 200, bottom: 264 }]))
      .toEqual({ top: 30, entry: null, offset: 0 });
  });

  it("keeps only the offset with no rows at all", () => {
    expect(placeOf(0, EDGE, [])).toEqual({ top: 0, entry: null, offset: 0 });
  });
});

describe("aimFor", () => {
  const pos = { top: 500, entry: "a", offset: -40 };

  it("puts the anchor row back at its offset", () => {
    // Drawn with the scroller at 0, row a sits 440px below the edge.
    expect(aimFor(pos, 0, EDGE, EDGE + 440)).toBe(480);
  });

  it("follows the row when an entry above it pushed it down", () => {
    // One 64px row saved above it: the same view is 64px further down.
    expect(aimFor(pos, 0, EDGE, EDGE + 440 + 64)).toBe(544);
  });

  it("is already there when the row is at its offset", () => {
    expect(aimFor(pos, 544, EDGE, EDGE - 40)).toBe(544);
  });

  it("falls back to the raw offset when the row has gone", () => {
    expect(aimFor(pos, 0, EDGE, undefined)).toBe(500);
  });
});

describe("returnTo", () => {
  it("names the return that arrived at a screen, and nothing else", () => {
    markReturn("/g?id=g1");
    const n = returnTo("http://app.invalid/g/?id=g1");
    expect(n).not.toBeNull();
    expect(returnTo("http://app.invalid/g?id=g2")).toBeNull();
  });

  it("numbers each return, so a screen spends one once", () => {
    markReturn("/g?id=g1");
    const first = returnTo("/g?id=g1");
    markReturn("/g?id=g1");
    expect(returnTo("/g?id=g1")).not.toBe(first);
  });
});
