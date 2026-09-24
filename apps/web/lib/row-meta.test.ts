import { describe, expect, it } from "vitest";
import { expenseMeta, groupMeta, transferMeta } from "./row-meta";

const base = { payer: "Alice", coPayers: 0, kind: "expense" as const, ways: 5, mode: "equal" as const };

describe("expenseMeta", () => {
  it("shortens a receipt split, mode first", () => {
    expect(expenseMeta({ ...base, coPayers: 1, mode: "receipt" })).toEqual([
      "Alice + 1 other paid · 5 people, by items",
      "Alice + 1 other paid · split 5 ways",
      "Alice +1 paid · split 5 ways",
      "Alice +1 paid · 5 ways",
      "Alice +1 paid",
    ]);
  });

  it("never drops the co-payers, only abbreviates them", () => {
    // "Alice paid" when Bob paid too is a false line, and no width justifies
    // one. Every rung still carries the "+2".
    for (const rung of expenseMeta({ ...base, coPayers: 2 })) {
      expect(rung).toMatch(/\+ ?2/);
    }
  });

  it("keeps the payer on every rung", () => {
    for (const rung of expenseMeta({ ...base, coPayers: 1, mode: "percent" })) {
      expect(rung.startsWith("Alice")).toBe(true);
    }
  });

  it("is strictly shortening", () => {
    const rungs = expenseMeta({ ...base, payer: "Wilhelmina", coPayers: 3, mode: "shares" });
    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i]!.length).toBeLessThan(rungs[i - 1]!.length);
    }
  });

  it("drops the rung an equal split would repeat", () => {
    // "split 5 ways" is already the whole of an equal split's mode, so the
    // ladder has four rungs here rather than five saying the same thing twice.
    expect(expenseMeta({ ...base, coPayers: 1 })).toEqual([
      "Alice + 1 other paid · split 5 ways",
      "Alice +1 paid · split 5 ways",
      "Alice +1 paid · 5 ways",
      "Alice +1 paid",
    ]);
  });

  it("collapses to one rung for a lone payer and an equal split", () => {
    expect(expenseMeta(base)).toEqual([
      "Alice paid · split 5 ways",
      "Alice paid · 5 ways",
      "Alice paid",
    ]);
  });

  it("says an income the income way", () => {
    expect(expenseMeta({ ...base, kind: "income" })[0]).toBe("Alice received · shared 5 ways");
  });

  it("counts one the singular way", () => {
    expect(expenseMeta({ ...base, ways: 1, coPayers: 1 })[0])
      .toBe("Alice + 1 other paid · split 1 way");
  });
});

describe("transferMeta", () => {
  it("says the note alone when there is one", () => {
    expect(transferMeta("Airport taxi")).toEqual(["Airport taxi"]);
    expect(transferMeta("  Airport taxi ")).toEqual(["Airport taxi"]);
  });

  it("says the label when there is no note", () => {
    expect(transferMeta(undefined)).toEqual(["Transfer"]);
    expect(transferMeta("   ")).toEqual(["Transfer"]);
    expect(transferMeta(null)).toEqual(["Transfer"]);
  });
});

describe("groupMeta", () => {
  it("drops people, then entries, and keeps the time", () => {
    expect(groupMeta({ people: 9, entries: 61, when: "2d ago" })).toEqual([
      "9 people · 61 entries · 2d ago",
      "61 entries · 2d ago",
      "2d ago",
    ]);
  });

  it("counts one the singular way", () => {
    expect(groupMeta({ people: 1, entries: 1, when: "just now" })[0])
      .toBe("1 person · 1 entry · just now");
  });
});
