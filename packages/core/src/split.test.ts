import { describe, expect, it } from "vitest";
import {
  convertSplitMode, resolveSplit, shareOf, splitParticipants, validateSplit,
} from "./split.js";
import type { SplitSpec } from "./types.js";

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe("resolveSplit — equal", () => {
  it("divides evenly when it can", () => {
    const r = resolveSplit(58000, { mode: "equal", members: ["a", "b", "c", "d"] });
    expect(r.shares).toEqual({ a: 14500, b: 14500, c: 14500, d: 14500 });
    expect(r.remainderAbsorbedBy).toEqual([]);
  });

  it("distributes the odd cent and says who took it", () => {
    // €10 across 3 people
    const r = resolveSplit(1000, { mode: "equal", members: ["a", "b", "c"] });
    expect(sum(r.shares)).toBe(1000);
    expect(Object.values(r.shares).sort()).toEqual([333, 333, 334]);
    expect(r.remainderAbsorbedBy).toHaveLength(1);
  });

  it("handles one cent across four people", () => {
    const r = resolveSplit(1, { mode: "equal", members: ["a", "b", "c", "d"] });
    expect(sum(r.shares)).toBe(1);
    expect(r.remainderAbsorbedBy).toEqual(["a"]);
  });

  it("is deterministic regardless of the order members were listed in", () => {
    const forwards = resolveSplit(1000, { mode: "equal", members: ["a", "b", "c"] });
    const backwards = resolveSplit(1000, { mode: "equal", members: ["c", "b", "a"] });
    expect(forwards).toEqual(backwards);
  });

  it("handles zero and single-member splits", () => {
    expect(resolveSplit(0, { mode: "equal", members: ["a", "b"] }).shares).toEqual({ a: 0, b: 0 });
    expect(resolveSplit(999, { mode: "equal", members: ["a"] }).shares).toEqual({ a: 999 });
  });

  it("deduplicates a member listed twice", () => {
    const r = resolveSplit(1000, { mode: "equal", members: ["a", "a", "b"] });
    expect(sum(r.shares)).toBe(1000);
    expect(Object.keys(r.shares).sort()).toEqual(["a", "b"]);
  });
});

describe("resolveSplit — shares", () => {
  it("weights the division", () => {
    const r = resolveSplit(30000, { mode: "shares", weights: { a: 2, b: 1 } });
    expect(r.shares).toEqual({ a: 20000, b: 10000 });
  });

  it("still sums exactly when weights don't divide", () => {
    const r = resolveSplit(1000, { mode: "shares", weights: { a: 1, b: 1, c: 1 } });
    expect(sum(r.shares)).toBe(1000);
  });

  it("gives a zero-weight member nothing", () => {
    const r = resolveSplit(1000, { mode: "shares", weights: { a: 1, b: 0 } });
    expect(r.shares).toEqual({ a: 1000, b: 0 });
  });

  it("refuses a split where nobody has any weight", () => {
    expect(() => resolveSplit(1000, { mode: "shares", weights: { a: 0, b: 0 } })).toThrow();
  });

  it("refuses negative or fractional weights", () => {
    expect(() => resolveSplit(1000, { mode: "shares", weights: { a: -1 } })).toThrow();
    expect(() => resolveSplit(1000, { mode: "shares", weights: { a: 1.5 } })).toThrow();
  });
});

describe("resolveSplit — percent", () => {
  it("apportions by basis points", () => {
    const r = resolveSplit(10000, { mode: "percent", bps: { a: 2500, b: 7500 } });
    expect(r.shares).toEqual({ a: 2500, b: 7500 });
  });

  it("sums exactly on thirds", () => {
    const r = resolveSplit(10000, { mode: "percent", bps: { a: 3333, b: 3333, c: 3334 } });
    expect(sum(r.shares)).toBe(10000);
  });
});

describe("resolveSplit — exact", () => {
  it("passes exact amounts through", () => {
    const spec: SplitSpec = { mode: "exact", amounts: { a: 8520, b: 8519 } };
    expect(resolveSplit(17039, spec).shares).toEqual({ a: 8520, b: 8519 });
  });

  it("refuses to resolve when the parts don't make the whole", () => {
    expect(() => resolveSplit(17039, { mode: "exact", amounts: { a: 8520, b: 8000 } })).toThrow();
  });
});

describe("three-decimal and zero-decimal currencies", () => {
  it("splits fils exactly", () => {
    const r = resolveSplit(1000, { mode: "equal", members: ["a", "b", "c"] }); // 1.000 TND
    expect(sum(r.shares)).toBe(1000);
  });

  it("splits yen exactly", () => {
    const r = resolveSplit(1000, { mode: "equal", members: ["a", "b", "c"] }); // ¥1000
    expect(sum(r.shares)).toBe(1000);
    expect(Object.values(r.shares).sort()).toEqual([333, 333, 334]);
  });
});

describe("validateSplit", () => {
  it("reports progress rather than throwing", () => {
    const v = validateSplit(17039, { mode: "exact", amounts: { a: 8520, b: 8000 } });
    expect(v.ok).toBe(false);
    expect(v.allocatedMinor).toBe(16520);
    // The shortfall comes back as a number, not a sentence: only the UI knows
    // the currency it should be shown in.
    expect(v.problem).toBe("under");
    expect(v.diffMinor).toBe(519);
  });

  it("flags over-allocation distinctly", () => {
    const v = validateSplit(1000, { mode: "exact", amounts: { a: 900, b: 200 } });
    expect(v.problem).toBe("over");
    expect(v.diffMinor).toBe(-100);
  });

  it("never puts minor units in a sentence a human will read", () => {
    const under = validateSplit(17039, { mode: "exact", amounts: { a: 8520, b: 8000 } });
    const over = validateSplit(1000, { mode: "exact", amounts: { a: 900, b: 200 } });
    for (const v of [under, over]) expect(v.message).not.toMatch(/minor units|\d/);
  });

  it("catches percentages that don't reach 100", () => {
    const v = validateSplit(10000, { mode: "percent", bps: { a: 5000, b: 4000 } });
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/90\.00%/);
  });

  it("rejects an empty split without blowing up", () => {
    expect(validateSplit(1000, { mode: "equal", members: [] }).ok).toBe(false);
  });

  it("accepts a well-formed split", () => {
    expect(validateSplit(1000, { mode: "equal", members: ["a", "b"] }).ok).toBe(true);
  });
});

describe("shareOf", () => {
  it("is zero for someone not involved", () => {
    expect(shareOf(17039, { mode: "equal", members: ["a", "b"] }, "z")).toBe(0);
    expect(shareOf(17039, { mode: "equal", members: ["a", "b"] }, "a")).toBe(8520);
  });
});

describe("convertSplitMode", () => {
  it("keeps everyone's amounts when moving to exact", () => {
    const before = resolveSplit(1000, { mode: "equal", members: ["a", "b", "c"] }).shares;
    const spec = convertSplitMode(1000, { mode: "equal", members: ["a", "b", "c"] }, "exact");
    expect(spec).toEqual({ mode: "exact", amounts: before });
  });

  it("produces percentages that still total 100%", () => {
    const spec = convertSplitMode(1000, { mode: "equal", members: ["a", "b", "c"] }, "percent");
    expect(spec.mode).toBe("percent");
    if (spec.mode !== "percent") throw new Error("unreachable");
    expect(Object.values(spec.bps).reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(validateSplit(1000, spec).ok).toBe(true);
  });

  it("preserves the participant set in every direction", () => {
    const start: SplitSpec = { mode: "shares", weights: { a: 2, b: 1 } };
    for (const mode of ["equal", "exact", "shares", "percent"] as const) {
      expect(splitParticipants(convertSplitMode(3000, start, mode))).toEqual(["a", "b"]);
    }
  });

  it("survives converting a zero-total expense", () => {
    const spec = convertSplitMode(0, { mode: "equal", members: ["a", "b", "c"] }, "percent");
    expect(validateSplit(0, spec).ok).toBe(true);
  });
});

describe("property: every split sums to the total", () => {
  it("holds across many random totals and member counts", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 500; i++) {
      const total = Math.floor(rand() * 1_000_000);
      const n = 1 + Math.floor(rand() * 8);
      const members = Array.from({ length: n }, (_, k) => `m${k}`);
      const weights: Record<string, number> = {};
      for (const m of members) weights[m] = Math.floor(rand() * 5);
      if (Object.values(weights).every((w) => w === 0)) weights[members[0]!] = 1;

      expect(sum(resolveSplit(total, { mode: "equal", members }).shares)).toBe(total);
      expect(sum(resolveSplit(total, { mode: "shares", weights }).shares)).toBe(total);
    }
  });
});
