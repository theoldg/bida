import { describe, expect, it } from "vitest";
import {
  addsUp, canonicalSplit, convertSplitMode, ownCurrencySplit, resolveEntrySplit, resolveSplit, shareOf, splitParticipants,
  toggleEveryone, upgradeReceiptSplit, validateSplit,
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

describe("addsUp", () => {
  it("is ok only on the exact total, with the gap signed", () => {
    expect(addsUp(1000, 1000)).toEqual({ ok: true, allocatedMinor: 1000, totalMinor: 1000 });
    expect(addsUp(999, 1000)).toMatchObject({ ok: false, problem: "under", diffMinor: 1 });
    expect(addsUp(1001, 1000)).toMatchObject({ ok: false, problem: "over", diffMinor: -1 });
    expect(addsUp(0, 0).ok).toBe(true);
  });
});

describe("validateSplit", () => {
  it("reports progress rather than throwing", () => {
    const v = validateSplit(17039, { mode: "exact", amounts: { a: 8520, b: 8000 } });
    expect(v.ok).toBe(false);
    expect(v.allocatedMinor).toBe(16520);
    // A number, not a sentence: only the UI knows the currency.
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

  // A zero share is nobody: kept, it would light every row of an empty
  // "as amounts" tab as in.
  it("moves to exact with nobody in when there is nothing to hand out", () => {
    const spec = convertSplitMode(0, { mode: "equal", members: ["a", "b", "c"] }, "exact");
    expect(spec).toEqual({ mode: "exact", amounts: {} });
    expect(splitParticipants(spec)).toEqual([]);
  });

  it("leaves out whoever a tiny total hands nothing", () => {
    const spec = convertSplitMode(2, { mode: "equal", members: ["a", "b", "c"] }, "exact");
    expect(spec.mode === "exact" && Object.values(spec.amounts)).toEqual([1, 1]);
    expect(splitParticipants(spec)).toHaveLength(2);
    expect(validateSplit(2, spec).ok).toBe(true);
  });

  it("reads a zero amount already written as out", () => {
    const spec: SplitSpec = { mode: "exact", amounts: { a: 500, b: 0 } };
    expect(splitParticipants(spec)).toEqual(["a"]);
    expect(resolveSplit(500, spec).shares).toEqual({ a: 500 });
    expect(shareOf(500, spec, "b")).toBe(0);
  });

  it("survives converting a zero-total expense", () => {
    const spec = convertSplitMode(0, { mode: "equal", members: ["a", "b", "c"] }, "percent");
    expect(validateSplit(0, spec).ok).toBe(true);
  });

  // Zeroing every part then switching tabs must not throw out of `resolveSplit`.
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

describe("toggleEveryone", () => {
  const all = ["a", "b", "c", "d"];

  it("evenly: some in brings everyone in, everyone in takes everyone out", () => {
    const some = toggleEveryone(400, { mode: "equal", members: ["a", "c"] }, all);
    expect(splitParticipants(some)).toEqual(all);
    expect(toggleEveryone(400, some as SplitSpec & { mode: "equal" }, all)).toEqual({ mode: "equal", members: [] });
    expect(splitParticipants(toggleEveryone(400, { mode: "equal", members: [] }, all))).toEqual(all);
  });

  it("parts: whoever is out gets one, and nobody else's parts move", () => {
    const spec = toggleEveryone(400, { mode: "shares", weights: { a: 2, c: 3 } }, all);
    expect(spec).toEqual({ mode: "shares", weights: { a: 2, b: 1, c: 3, d: 1 } });
    expect(toggleEveryone(400, { mode: "shares", weights: { a: 2, b: 1, c: 3, d: 1 } }, all))
      .toEqual({ mode: "shares", weights: {} });
  });

  it("amounts: from empty, everyone gets an even share that adds up", () => {
    const spec = toggleEveryone(1001, { mode: "exact", amounts: {} }, all, { tiebreakSeed: "e1" });
    expect(splitParticipants(spec)).toEqual(all);
    expect(validateSplit(1001, spec).ok).toBe(true);
    if (spec.mode !== "exact") throw new Error("unreachable");
    for (const v of Object.values(spec.amounts)) expect([250, 251]).toContain(v);
  });

  it("amounts: typed figures stay, and the empty rows share what is left", () => {
    const spec = toggleEveryone(32000, { mode: "exact", amounts: { a: 12000, d: 8000 } }, all);
    expect(spec).toEqual({ mode: "exact", amounts: { a: 12000, b: 6000, c: 6000, d: 8000 } });
    expect(validateSplit(32000, spec).ok).toBe(true);
  });

  it("amounts: with nothing left, or everyone in, it clears", () => {
    const full = { mode: "exact" as const, amounts: { a: 500, b: 500 } };
    expect(toggleEveryone(1000, full, all)).toEqual({ mode: "exact", amounts: {} });
    const over = { mode: "exact" as const, amounts: { a: 900, b: 900 } };
    expect(toggleEveryone(1000, over, all)).toEqual({ mode: "exact", amounts: {} });
    const everyone = { mode: "exact" as const, amounts: { a: 1, b: 1, c: 1, d: 1 } };
    expect(toggleEveryone(1000, everyone, all)).toEqual({ mode: "exact", amounts: {} });
  });

  // Fewer minor units left than empty rows: whoever the rest can't reach stays
  // out, as `convertSplitMode` leaves them, and the split still adds up.
  it("amounts: a rest smaller than the empty rows hands out what there is", () => {
    const spec = toggleEveryone(1002, { mode: "exact", amounts: { a: 1000 } }, all, { tiebreakSeed: "x" });
    if (spec.mode !== "exact") throw new Error("unreachable");
    expect(spec.amounts.a).toBe(1000);
    expect(splitParticipants(spec)).toHaveLength(3);
    expect(Object.values(spec.amounts)).not.toContain(0);
    expect(validateSplit(1002, spec).ok).toBe(true);
  });

  it("amounts: a zero-decimal total splits in whole units", () => {
    const spec = toggleEveryone(1000, { mode: "exact", amounts: {} }, ["a", "b", "c"]);
    if (spec.mode !== "exact") throw new Error("unreachable");
    expect(sum(spec.amounts)).toBe(1000);
    expect(Object.values(spec.amounts).sort()).toEqual([333, 333, 334]);
  });

  it("property: filling the gaps of an under-allocated split makes it add up", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 300; i++) {
      const n = 2 + Math.floor(rand() * 7);
      const members = Array.from({ length: n }, (_, k) => `m${k}`);
      const total = n + Math.floor(rand() * 1_000_000);
      const amounts: Record<string, number> = {};
      let given = 0;
      for (const m of members.slice(1)) {
        if (rand() < 0.5) continue;
        const v = Math.floor(rand() * (total - n - given) / n);
        if (v > 0) { amounts[m] = v; given += v; }
      }
      const spec = toggleEveryone(total, { mode: "exact", amounts }, members, { tiebreakSeed: `s${i}` });
      if (spec.mode !== "exact") throw new Error("unreachable");
      expect(sum(spec.amounts)).toBe(total);
      expect(splitParticipants(spec)).toEqual([...members].sort());
      for (const [id, v] of Object.entries(amounts)) expect(spec.amounts[id]).toBe(v);
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
  // JSON.stringify is what the command layer and history compare with.
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
  // Legacy receipts are `shares` plus `splitTab: "receipt"`; one upgrade where
  // ops become state makes them `receipt` splits.
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

  // No flag: a `shares` spec beside a scanned bill can only be a finished grid.
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

describe("resolveEntrySplit — exact amounts in the entry's own currency", () => {
  // 1000 MAD at 0.0917 → €91.70; amounts typed in dirham.
  const entry = (amounts: Record<string, number>, amountMinor = 100000, baseAmountMinor = 9170) => ({
    id: "e1", amountMinor, baseAmountMinor, split: { mode: "exact" as const, amounts },
  });

  it("apportions the base total by the own-currency amounts", () => {
    expect(resolveEntrySplit(entry({ a: 60000, b: 40000 })).shares).toEqual({ a: 5502, b: 3668 });
  });

  it("sums to the base total exactly when the conversion leaves a cent", () => {
    for (const base of [1, 2, 9170, 9171, 33333, 1_000_001]) {
      const r = resolveEntrySplit(entry({ a: 33334, b: 33333, c: 33333 }, 100000, base));
      expect(sum(r.shares)).toBe(base);
    }
  });

  it("works out of a 3-decimal currency into a 0-decimal base", () => {
    // 12.345 KWD → ¥5,800; amounts in fils.
    const r = resolveEntrySplit(entry({ a: 10000, b: 2345 }, 12345, 5800));
    expect(r.shares).toEqual({ a: 4698, b: 1102 });
  });

  it("is deterministic whatever order the amounts arrive in", () => {
    const a = resolveEntrySplit(entry({ a: 1, b: 1, c: 1 }, 3, 100));
    const b = resolveEntrySplit(entry({ c: 1, b: 1, a: 1 }, 3, 100));
    expect(a.shares).toEqual(b.shares);
    expect(sum(a.shares)).toBe(100);
  });

  it("reads a pre-change entry's base amounts unchanged", () => {
    expect(resolveEntrySplit(entry({ a: 5000, b: 4170 })).shares).toEqual({ a: 5000, b: 4170 });
  });

  it("is plain resolveSplit in the base currency", () => {
    expect(resolveEntrySplit(entry({ a: 700, b: 300 }, 1000, 1000)).shares).toEqual({ a: 700, b: 300 });
  });

  it("refuses amounts matching neither total", () => {
    expect(() => resolveEntrySplit(entry({ a: 50000 }))).toThrow(/allocates 50000/);
  });

  it("leaves every other mode to resolveSplit over the base", () => {
    const r = resolveEntrySplit({ id: "e1", amountMinor: 100000, baseAmountMinor: 9170,
      split: { mode: "equal", members: ["a", "b"] } });
    expect(sum(r.shares)).toBe(9170);
  });
});

describe("ownCurrencySplit", () => {
  it("converts a pre-change base-currency exact split back over the own amount", () => {
    const s = ownCurrencySplit({ id: "e1", amountMinor: 100000, baseAmountMinor: 9170,
      split: { mode: "exact", amounts: { a: 5000, b: 4170 } } });
    expect(s).toEqual({ mode: "exact", amounts: { a: 54526, b: 45474 } });
  });

  it("hands anything else over as it is", () => {
    const own = { mode: "exact" as const, amounts: { a: 60000, b: 40000 } };
    expect(ownCurrencySplit({ id: "e1", amountMinor: 100000, baseAmountMinor: 9170, split: own })).toBe(own);
    const even = { mode: "equal" as const, members: ["a"] };
    expect(ownCurrencySplit({ id: "e1", amountMinor: 100000, baseAmountMinor: 9170, split: even })).toBe(even);
  });
});
