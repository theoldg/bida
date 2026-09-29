import { describe, expect, it } from "vitest";
import { expenseMeta, groupMeta, historyMeta, transferMeta } from "./row-meta";

const base = { payer: "Alice", coPayers: [] as string[], kind: "expense" as const, ways: 5, mode: "equal" as const };

describe("expenseMeta", () => {
  it("shortens a receipt split, mode first", () => {
    expect(expenseMeta({ ...base, coPayers: ["Bob"], mode: "receipt" })).toEqual([
      "Alice & Bob paid · 5 people, by items",
      "Alice & Bob paid · split 5 ways",
      "Alice +1 paid · split 5 ways",
      "Alice +1 paid · 5 ways",
      "Alice +1 paid",
    ]);
  });

  it("never drops the co-payers, only abbreviates them", () => {
    // "Alice paid" when Bob paid too is a false line, and no width justifies
    // one. Every rung still carries the "+2".
    for (const rung of expenseMeta({ ...base, coPayers: ["Bob", "Cy"] })) {
      expect(rung).toMatch(/\+ ?2/);
    }
  });

  it("keeps the payer on every rung", () => {
    for (const rung of expenseMeta({ ...base, coPayers: ["Bob"], mode: "percent" })) {
      expect(rung.startsWith("Alice")).toBe(true);
    }
  });

  it("is strictly shortening", () => {
    const rungs = expenseMeta({ ...base, payer: "Wilhelmina", coPayers: ["Bob", "Cy", "Di"], mode: "shares" });
    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i]!.length).toBeLessThan(rungs[i - 1]!.length);
    }
  });

  it("drops the rung an equal split would repeat", () => {
    // "split 5 ways" is already the whole of an equal split's mode, so the
    // ladder has four rungs here rather than five saying the same thing twice.
    expect(expenseMeta({ ...base, coPayers: ["Bob"] })).toEqual([
      "Alice & Bob paid · split 5 ways",
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
    expect(expenseMeta({ ...base, ways: 1, coPayers: ["Bob", "Cy"] })[0])
      .toBe("Alice + 2 others paid · split 1 way");
  });

  it("names a second payer, and counts from a third", () => {
    // "Alice + 1 other" hides a name that fits in the same space.
    expect(expenseMeta({ ...base, coPayers: ["Bob"] })[0]).toBe("Alice & Bob paid · split 5 ways");
    expect(expenseMeta({ ...base, coPayers: ["Bob", "Cy"] })[0]).toBe("Alice + 2 others paid · split 5 ways");
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

describe("historyMeta", () => {
  it("names the creator of an entry nobody edited, then falls back to History", () => {
    expect(historyMeta({ edits: 0, creator: "Luke", lastEditor: "Luke" }))
      .toEqual(["Created by Luke", "History"]);
  });

  it("counts the edits and names the last editor, then drops the name", () => {
    expect(historyMeta({ edits: 1, creator: "Luke", lastEditor: "Han" }))
      .toEqual(["Edited once · by Han", "Edited once"]);
    expect(historyMeta({ edits: 3, creator: "Luke", lastEditor: "Han" }))
      .toEqual(["Edited 3 times · last by Han", "Edited 3 times"]);
  });

  it("says an untouched imported entry was imported, not created", () => {
    expect(historyMeta({ edits: 0, creator: "Luke", lastEditor: "Luke", imported: "Tricount" }))
      .toEqual(["Imported from Tricount by Luke", "Imported from Tricount"]);
    // A group imported before it kept its source.
    expect(historyMeta({ edits: 0, creator: "Luke", lastEditor: "Luke", imported: true }))
      .toEqual(["Imported by Luke", "Imported"]);
    // Once edited, the edits are the news.
    expect(historyMeta({ edits: 1, creator: "Luke", lastEditor: "Han", imported: "Tricount" }))
      .toEqual(["Edited once · by Han", "Edited once"]);
  });
});
