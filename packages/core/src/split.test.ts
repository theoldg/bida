import { describe, expect, it } from "vitest";
import {
  canonicalSplit, convertSplitMode, resolveSplit, shareOf, splitParticipants,
  upgradeReceiptSplit, validateSplit,
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

  // Zeroing every part in the editor and then switching tabs used to throw out
  // of `resolveSplit`, leaving the tab unswitched and an error on the console.
  it("carries an empty split into every mode instead of throwing", () => {
    const empty: SplitSpec[] = [
      { mode: "equal", members: [] },
      { mode: "exact", amounts: {} },
      { mode: "shares", weights: {} },
      { mode: "percent", bps: {} },
    ];
    for (const start of empty) {
      for (const mode of ["equal", "exact", "shares", "percent"] as const) {
        const spec = convertSplitMode(4500, start, mode);
        expect(spec.mode).toBe(mode);
        expect(splitParticipants(spec)).toEqual([]);
      }
    }
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

describe("canonicalSplit", () => {
  // The whole point: JSON.stringify is what the command layer and the history
  // compare with, so two specs meaning the same thing must serialise the same.
  it("sorts members, whatever order they were picked in", () => {
    const picked: SplitSpec = { mode: "equal", members: ["c", "a", "b"] };
    expect(JSON.stringify(canonicalSplit(picked)))
      .toBe(JSON.stringify(canonicalSplit({ mode: "equal", members: ["a", "b", "c"] })));
  });

  it("drops a member named twice", () => {
    expect(canonicalSplit({ mode: "equal", members: ["b", "a", "b"] }))
      .toEqual({ mode: "equal", members: ["a", "b"] });
  });

  it("sorts the keys of every weighted mode", () => {
    expect(JSON.stringify(canonicalSplit({ mode: "shares", weights: { b: 2, a: 1 } })))
      .toBe(JSON.stringify({ mode: "shares", weights: { a: 1, b: 2 } }));
    expect(JSON.stringify(canonicalSplit({ mode: "exact", amounts: { b: 200, a: 100 } })))
      .toBe(JSON.stringify({ mode: "exact", amounts: { a: 100, b: 200 } }));
    expect(JSON.stringify(canonicalSplit({ mode: "percent", bps: { b: 4000, a: 6000 } })))
      .toBe(JSON.stringify({ mode: "percent", bps: { a: 6000, b: 4000 } }));
  });

  it("changes nothing about the arithmetic", () => {
    const spec: SplitSpec = { mode: "shares", weights: { c: 3, a: 1, b: 2 } };
    expect(resolveSplit(6000, canonicalSplit(spec), { tiebreakSeed: "e1" }).shares)
      .toEqual(resolveSplit(6000, spec, { tiebreakSeed: "e1" }).shares);
  });
});

describe("upgradeReceiptSplit", () => {
  // A receipt used to be stored as `shares` with a `splitTab: "receipt"` flag
  // beside it, and four screens — the ledger row, the entry, the history and
  // the form's own tab — each asked those two fields their own way. This is
  // what is left of that: one upgrade, run where ops become state, after which
  // a receipt is a `receipt` split and nobody asks a second field.
  const items = [{ label: "Tea", amount: "3.00" }];
  const weights = { a: 1, b: 2 };
  const legacy = (extra: Record<string, unknown>): { split: SplitSpec } => {
    const entity: Record<string, unknown> = {
      split: { mode: "shares", weights }, ...extra,
    };
    upgradeReceiptSplit(entity);
    return entity as unknown as { split: SplitSpec };
  };

  it("makes a flagged shares split a receipt one", () => {
    expect(legacy({ splitTab: "receipt", receiptItems: items }).split)
      .toEqual({ mode: "receipt", weights });
  });

  // Entries predating the flag have no tab to read: a `shares` spec beside a
  // scanned bill is the only thing a finished grid could have written.
  it("reads an entry saved before the tab was stored", () => {
    expect(legacy({ receiptItems: items }).split).toEqual({ mode: "receipt", weights });
  });

  it("leaves parts somebody typed alone", () => {
    // No bill behind it, or a person who moved to another tab and saved.
    expect(legacy({ splitTab: "receipt", receiptItems: [] }).split.mode).toBe("shares");
    expect(legacy({ receiptItems: null }).split.mode).toBe("shares");
    expect(legacy({ splitTab: "shares", receiptItems: items }).split.mode).toBe("shares");
  });

  it("drops the flag either way — nothing reads it any more", () => {
    expect("splitTab" in legacy({ splitTab: "receipt", receiptItems: items })).toBe(false);
    expect("splitTab" in legacy({ splitTab: "equal", receiptItems: items })).toBe(false);
  });

  it("is content with an entity that has no split at all", () => {
    const partial: Record<string, unknown> = { id: "m1", name: "Teo" };
    expect(() => upgradeReceiptSplit(partial)).not.toThrow();
    expect(partial).toEqual({ id: "m1", name: "Teo" });
  });
});

describe("a receipt split", () => {
  const spec: SplitSpec = { mode: "receipt", weights: { a: 2000, b: 1000 } };

  it("divides by weight, like the parts it used to be written as", () => {
    expect(resolveSplit(3000, spec).shares).toEqual({ a: 2000, b: 1000 });
    expect(resolveSplit(3000, spec).shares)
      .toEqual(resolveSplit(3000, { mode: "shares", weights: { a: 2000, b: 1000 } }).shares);
  });

  it("names its participants and canonicalises like any other spec", () => {
    expect(splitParticipants(spec)).toEqual(["a", "b"]);
    expect(canonicalSplit({ mode: "receipt", weights: { b: 1, a: 2 } }))
      .toEqual({ mode: "receipt", weights: { a: 2, b: 1 } });
  });

  it("converts away into a mode somebody types", () => {
    expect(convertSplitMode(3000, spec, "equal")).toEqual({ mode: "equal", members: ["a", "b"] });
    expect(convertSplitMode(3000, spec, "exact")).toEqual({ mode: "exact", amounts: { a: 2000, b: 1000 } });
  });
});
