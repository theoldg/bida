import { describe, expect, it } from "vitest";
import { TIP_USD_MINOR, tipShareMinor } from "./tip";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);

/**
 * The tip screen prints one figure that is money, so it gets the treatment
 * money gets. The arithmetic is core's — these pin the edges the screen can
 * actually hit.
 */
describe("tipShareMinor", () => {
  it("is the whole tip when there is nobody to share it with", () => {
    expect(tipShareMinor([])).toBe(TIP_USD_MINOR);
    expect(tipShareMinor(ids(1))).toBe(TIP_USD_MINOR);
  });

  it("divides evenly when it divides evenly", () => {
    expect(tipShareMinor(ids(2))).toBe(250);
    expect(tipShareMinor(ids(4))).toBe(125);
    expect(tipShareMinor(ids(5))).toBe(100);
  });

  it("rounds the printed share up, never down", () => {
    // 500/3 is 167/167/166 — printing 166 would ask for $4.98.
    expect(tipShareMinor(ids(3))).toBe(167);
    expect(tipShareMinor(ids(6))).toBe(84);
    expect(tipShareMinor(ids(7))).toBe(72);
  });

  it("never prints nothing, however many people are in the group", () => {
    for (let n = 1; n <= 60; n++) expect(tipShareMinor(ids(n))).toBeGreaterThan(0);
  });
});
