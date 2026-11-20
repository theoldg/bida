import { describe, expect, it } from "vitest";
import { canonicalSplit, convertSplitMode, resolveEntrySplit, resolveSplit, splitParticipants, validateSplit } from "./split";
import {
  addDays, daysBetween, dragStayEnd, emptyStayRows, restay, seedStay, setStayAll, setStayRun, stayCount,
  stayDates, stayEnd, stayersOn, stayHeads, stayRunAt, stayWeights, toggleStayRow, MAX_STAY,
} from "./stay";
import type { DaysSplit } from "./types";

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

/** Seven nights from 14 May: Ana misses the first, Bruno leaves after four… */
const villa: DaysSplit = {
  mode: "days", unit: "night", from: "2026-05-14", count: 7,
  stays: {
    ana: "0111111",
    bruno: "1111000",
    chloe: "1111110",
    dev: "0011111",
    eli: "0001111",
  },
};

/** What each person owes as an exact fraction of the total, row by row. */
function ideal(total: number, spec: DaysSplit): Record<string, number> {
  const heads = stayHeads(spec);
  const out: Record<string, number> = {};
  for (const id of Object.keys(spec.stays)) {
    out[id] = heads.reduce((a, h, i) => a + (spec.stays[id]![i] === "1" ? total / spec.count / h : 0), 0);
  }
  return out;
}

describe("a split by days", () => {
  it("costs each person a night's share of whoever was there that night", () => {
    expect(stayHeads(villa)).toEqual([2, 3, 4, 5, 4, 4, 3]);
    const { shares } = resolveSplit(120_000, villa, { tiebreakSeed: "x" });
    expect(sum(shares)).toBe(120_000);
    const want = ideal(120_000, villa);
    for (const id of Object.keys(want)) expect(Math.abs(shares[id]! - want[id]!)).toBeLessThan(1);
  });

  it("charges more a head on a night fewer share", () => {
    const two: DaysSplit = { mode: "days", unit: "night", from: "2026-05-14", count: 2, stays: { a: "11", b: "11", c: "01" } };
    // Night one: a and b halve it; night two: three ways. a pays 1/2 + 1/3 of a night.
    const { shares } = resolveSplit(1200, two);
    expect(shares).toEqual({ a: 500, b: 500, c: 200 });
  });

  it("is evenly when everyone is there throughout", () => {
    const all = seedStay("2026-01-01", "day", 5, ["a", "b", "c"]);
    expect(resolveSplit(1000, all, { tiebreakSeed: "s" }).shares)
      .toEqual(resolveSplit(1000, { mode: "equal", members: ["a", "b", "c"] }, { tiebreakSeed: "s" }).shares);
  });

  it("adds up to the minor unit at any exponent's sizes", () => {
    for (const total of [0, 1, 2, 7, 99, 100, 101, 999_999, 123_456_789]) {
      const { shares } = resolveSplit(total, villa, { tiebreakSeed: "seed" });
      expect(sum(shares)).toBe(total);
      const want = ideal(total, villa);
      for (const id of Object.keys(want)) expect(Math.abs(shares[id]! - want[id]!)).toBeLessThan(1);
    }
  });

  it("holds every random stay to its ideal and to the total", () => {
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    for (let n = 0; n < 300; n++) {
      const count = 1 + Math.floor(rand() * 20);
      const people = 1 + Math.floor(rand() * 9);
      const stays: Record<string, string> = {};
      for (let p = 0; p < people; p++) {
        stays[`m${p}`] = Array.from({ length: count }, () => (rand() < 0.6 ? "1" : "0")).join("");
      }
      // Somebody at every row, or the stay is refused (below).
      stays["host"] = "1".repeat(count);
      const spec: DaysSplit = { mode: "days", unit: "night", from: "2026-02-27", count, stays };
      const total = Math.floor(rand() * 1_000_000);
      const { shares } = resolveSplit(total, spec, { tiebreakSeed: `r${n}` });
      expect(sum(shares)).toBe(total);
      const want = ideal(total, spec);
      for (const id of splitParticipants(spec)) expect(Math.abs(shares[id]! - want[id]!)).toBeLessThan(1);
    }
  });

  it("weighs in smallest whole terms", () => {
    expect(stayWeights({ mode: "days", unit: "night", from: "2026-05-14", count: 2, stays: { a: "11", b: "11", c: "01" } }))
      .toEqual({ a: 5, b: 5, c: 2 });
  });

  it("weighs a crowd of every size exactly", () => {
    // 30 people, leaving one a night: every head count from 30 down to 1.
    const stays: Record<string, string> = {};
    for (let p = 0; p < 30; p++) stays[`p${String(p).padStart(2, "0")}`] = "1".repeat(p + 1).padEnd(30, "0");
    const spec: DaysSplit = { mode: "days", unit: "day", from: "2026-01-01", count: 30, stays };
    expect(stayWeights(spec)).not.toBeNull();
    const { shares } = resolveSplit(3_000_000, spec);
    expect(sum(shares)).toBe(3_000_000);
  });

  it("refuses a night nobody was at, naming the first", () => {
    const gap: DaysSplit = { ...villa, stays: { ...villa.stays, ana: "0111111", bruno: "0111000", chloe: "0111110" } };
    expect(emptyStayRows(gap)).toEqual([0]);
    expect(() => resolveSplit(100, gap)).toThrow();
    const v = validateSplit(100, gap);
    expect(v.ok).toBe(false);
    expect(v.problem).toBe("emptyDay");
    expect(v.emptyDays).toEqual({ first: "2026-05-14", count: 1 });
  });

  it("names nobody when nobody stayed, and nothing when the shape is broken", () => {
    expect(validateSplit(100, { ...villa, stays: {} }).problem).toBe("empty");
    expect(splitParticipants({ ...villa, count: 0 })).toEqual([]);
    expect(splitParticipants({ ...villa, from: "May 14" })).toEqual([]);
    expect(splitParticipants({ ...villa, count: MAX_STAY + 1 })).toEqual([]);
  });

  it("is read off a stored entry like any other split", () => {
    const entry = { id: "e1", amountMinor: 120_000, baseAmountMinor: 60_000, split: villa };
    expect(sum(resolveEntrySplit(entry).shares)).toBe(60_000);
  });

  it("is written with nobody who never came and every string the stay's length", () => {
    const messy: DaysSplit = { mode: "days", unit: "night", from: "2026-05-14", count: 3, stays: { z: "1", a: "0000", m: "01111" } };
    expect(JSON.stringify(canonicalSplit(messy)))
      .toBe(JSON.stringify({ mode: "days", unit: "night", from: "2026-05-14", count: 3, stays: { m: "011", z: "100" } }));
  });

  it("carries who stayed into another mode", () => {
    expect(convertSplitMode(villa, "equal")).toEqual({ mode: "equal", members: ["ana", "bruno", "chloe", "dev", "eli"] });
  });
});

describe("a stay's calendar", () => {
  it("counts nights to the morning you leave, and days to the last one", () => {
    expect(stayEnd(villa)).toBe("2026-05-21");
    expect(stayEnd({ ...villa, unit: "day" })).toBe("2026-05-20");
    expect(stayDates(villa)[6]).toBe("2026-05-20");
  });

  it("says who was there on a date, and nothing outside the stay", () => {
    expect(stayersOn(villa, "2026-05-14")).toEqual(["bruno", "chloe"]);
    expect(stayersOn(villa, "2026-05-20")).toEqual(["ana", "dev", "eli"]);
    expect(stayersOn(villa, "2026-05-21")).toBeNull();
    expect(stayersOn(villa, "2026-05-13")).toBeNull();
  });

  it("crosses a month, a leap day and a clock change as calendar dates", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("keeps who was there as the dates move, growing from the edge rows", () => {
    // Two nights earlier and one later: the new first nights copy the old first.
    const moved = restay(villa, "2026-05-12", "2026-05-22")!;
    expect(moved.count).toBe(10);
    expect(moved.stays["ana"]).toBe("000111111" + "1");
    expect(moved.stays["bruno"]).toBe("111111000" + "0");
    const shorter = restay(villa, "2026-05-16", "2026-05-18")!;
    expect(shorter.stays["bruno"]).toBe("11");
    expect(restay(villa, "2026-05-16", "2026-05-16")).toBeNull();
    // Grown for one person's dates, nobody else is on the new nights.
    expect(restay(villa, "2026-05-13", "2026-05-21", "night", "away")!.stays["ana"]).toBe("00111111");
  });

  it("switches nights to days without moving anybody", () => {
    const days = restay(villa, villa.from, stayEnd({ ...villa, unit: "day" }), "day")!;
    expect(days.count).toBe(7);
    expect(days.stays).toEqual(villa.stays);
  });

  it("flips a row, sets a run, and takes a person in or out whole", () => {
    expect(toggleStayRow(villa, "ana", 0).stays["ana"]).toBe("1111111");
    expect(setStayRun(villa, "eli", 5, 1).stays["eli"]).toBe("0111110");
    expect(stayCount(setStayAll(villa, "eli", true), "eli")).toBe(7);
    expect(setStayAll(villa, "eli", false).stays["eli"]).toBeUndefined();
  });

  it("drags either end of a run without crossing the other", () => {
    const run = stayRunAt(villa, "bruno", 2)!;
    expect(run).toEqual({ first: 0, last: 3 });
    expect(dragStayEnd(villa, "bruno", run, "last", 5).stays["bruno"]).toBe("1111110");
    expect(dragStayEnd(villa, "bruno", run, "last", 1).stays["bruno"]).toBe("1100000");
    expect(dragStayEnd(villa, "bruno", run, "first", 6).stays["bruno"]).toBe("0001000");
    expect(stayRunAt(villa, "ana", 0)).toBeNull();
  });
});
