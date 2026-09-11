import { describe, expect, it } from "vitest";
import { parseMinor } from "@bida/core";
import {
  foldPortions, handOffReceiptTotal, portions, receiptBreakdown, receiptTotalMinor, unfoldItem,
  unfoldableInto, weightsFromItems,
} from "./items";

describe("weightsFromItems", () => {
  it("splits each item evenly among its assigned members", () => {
    const weights = weightsFromItems(
      [{ amount: "10.00" }],
      [new Set(["a", "b"])],
      null,
      "EUR",
      "seed",
    );
    expect(weights["a"]! + weights["b"]!).toBe(1000);
    expect(weights["a"]).toBeCloseTo(weights["b"]!, -1);
  });

  it("scales the tip to what each person already ordered, not evenly", () => {
    // "a" had a €30 item alone; "b" had a €10 item alone. A €4 tip should
    // land roughly 3:1 in a's favour, not split €2/€2.
    const weights = weightsFromItems(
      [{ amount: "30.00" }, { amount: "10.00" }],
      [new Set(["a"]), new Set(["b"])],
      { amount: "4.00", members: new Set(["a", "b"]) },
      "EUR",
      "seed",
    );
    // a: 3000 (item) + 300 (75% of the 400 tip); b: 1000 + 100.
    expect(weights["a"]).toBe(3300);
    expect(weights["b"]).toBe(1100);
  });

  it("falls back to an even tip split when nobody has an item weight yet", () => {
    const weights = weightsFromItems(
      [],
      [],
      { amount: "4.00", members: new Set(["a", "b"]) },
      "EUR",
      "seed",
    );
    expect(weights["a"]! + weights["b"]!).toBe(400);
    expect(weights["a"]).toBe(200);
    expect(weights["b"]).toBe(200);
  });

  it("gives someone who ordered nothing no share of the tip", () => {
    // "c" is marked present (so it's in tip.members) but had no items — a
    // proportional tip should give them nothing, same as their item total.
    const weights = weightsFromItems(
      [{ amount: "20.00" }],
      [new Set(["a"])],
      { amount: "4.00", members: new Set(["a", "c"]) },
      "EUR",
      "seed",
    );
    expect(weights["a"]).toBe(2400);
    expect(weights["c"]).toBeUndefined();
  });
});

describe("receiptTotalMinor", () => {
  it("sums every item plus the tip", () => {
    expect(receiptTotalMinor(
      [{ amount: "10.00" }, { amount: "5.50" }],
      "1.50",
      "EUR",
    )).toBe(1700);
  });

  it("is null when there's a tip but no readable items", () => {
    expect(receiptTotalMinor([], "1.50", "EUR")).toBeNull();
  });

  it("skips a line item it can't parse rather than throwing", () => {
    expect(receiptTotalMinor(
      [{ amount: "not a number" }, { amount: "10.00" }],
      null,
      "EUR",
    )).toBe(1000);
  });

  it("ignores an unparsable tip but keeps the items", () => {
    expect(receiptTotalMinor([{ amount: "10.00" }], "garbage", "EUR")).toBe(1000);
  });
});

describe("handOffReceiptTotal", () => {
  it("pins the derived total when leaving Receipt for an arithmetic tab", () => {
    // The bug this exists for: Receipt derives its total and never stores it,
    // so switching to Evenly fell back to a blank `amountText` and the
    // expense silently became worth zero — a greyed-out Save, and
    // "€0.00 of €0.00 allocated" one more tap along.
    expect(handOffReceiptTotal(
      "receipt", "equal", [{ amount: "30.00" }, { amount: "10.00" }], "4.00", "EUR",
    )).toBe("44.00");
  });

  it("hands over text the amount field can parse back", () => {
    // `bare()` would give "1,234.50" here, which parseMinor rejects outright —
    // and JPY "25,000", which it reads as 25. The handoff has to be canonical.
    const eur = handOffReceiptTotal("receipt", "exact", [{ amount: "1234.50" }], null, "EUR");
    expect(parseMinor(eur!, "EUR")).toBe(123450);
    const jpy = handOffReceiptTotal("receipt", "exact", [{ amount: "25000" }], null, "JPY");
    expect(parseMinor(jpy!, "JPY")).toBe(25000);
  });

  it("leaves a hand-typed amount alone between two arithmetic tabs", () => {
    // Once someone has taken the number back, it is theirs — this is a
    // one-shot handoff at the transition, not a mirror of the bill.
    expect(handOffReceiptTotal("equal", "exact", [{ amount: "30.00" }], null, "EUR")).toBeNull();
  });

  it("leaves the amount alone when switching into Receipt", () => {
    // Receipt takes the total over by deriving it; nothing to write.
    expect(handOffReceiptTotal("exact", "receipt", [{ amount: "30.00" }], null, "EUR")).toBeNull();
  });

  it("leaves the amount alone when the bill has no readable total", () => {
    expect(handOffReceiptTotal("receipt", "equal", [], null, "EUR")).toBeNull();
    expect(handOffReceiptTotal("receipt", "equal", null, null, "EUR")).toBeNull();
    expect(handOffReceiptTotal("receipt", "equal", undefined, undefined, "EUR")).toBeNull();
  });
});

describe("unfoldItem", () => {
  const salad = { label: "Salad", amount: "9.00", quantity: 2 };

  it("splits a printed line into one row per unit, summing back to the line", () => {
    const out = unfoldItem([salad], 0, "EUR")!;
    expect(out.items).toEqual([
      { label: "Salad", amount: "4.50", quantity: null, portionOf: 2 },
      { label: "Salad", amount: "4.50", quantity: null, portionOf: 2 },
    ]);
    expect(receiptTotalMinor(out.items, null, "EUR")).toBe(900);
  });

  it("keeps the bill's total exactly when the line doesn't divide", () => {
    // 9.01 over three: 3.01 + 3.00 + 3.00. Never 3.00 × 3 with a lost cent,
    // which would move the expense's amount and the tip percentage with it.
    const out = unfoldItem([{ label: "Beer", amount: "9.01", quantity: 3 }], 0, "EUR")!;
    expect(out.items.map((i) => i.amount)).toEqual(["3.01", "3.00", "3.00"]);
    expect(receiptTotalMinor(out.items, null, "EUR")).toBe(901);
  });

  it("splits in the currency's own minor units", () => {
    // JPY has no cents: 5 yen over 2 is 3 + 2, not 2.50.
    const out = unfoldItem([{ label: "Tea", amount: "5", quantity: 2 }], 0, "JPY")!;
    expect(out.items.map((i) => i.amount)).toEqual(["3", "2"]);
    expect(receiptTotalMinor(out.items, null, "JPY")).toBe(5);
  });

  it("leaves the rest of the bill where it was", () => {
    const out = unfoldItem([{ label: "Soup", amount: "3.00" }, salad, { label: "Wine", amount: "8.00" }], 1, "EUR")!;
    expect(out.items.map((i) => i.label)).toEqual(["Soup", "Salad", "Salad", "Wine"]);
    expect(out.at).toBe(1);
    expect(out.count).toBe(2);
  });

  it("refuses a line there's nothing to unfold", () => {
    expect(unfoldableInto({ label: "Soup", amount: "3.00" }, "EUR")).toBeNull();
    expect(unfoldableInto({ label: "Soup", amount: "3.00", quantity: 1 }, "EUR")).toBeNull();
    expect(unfoldableInto({ label: "Soup", amount: "0.00", quantity: 2 }, "EUR")).toBeNull();
    expect(unfoldableInto({ label: "Soup", amount: "??", quantity: 2 }, "EUR")).toBeNull();
    // A portion is already one unit; it can't be unfolded again.
    expect(unfoldableInto({ label: "Salad", amount: "4.50", quantity: 2, portionOf: 2 }, "EUR")).toBeNull();
    expect(unfoldItem([{ label: "Soup", amount: "3.00" }], 0, "EUR")).toBeNull();
    expect(unfoldItem([salad], 4, "EUR")).toBeNull();
  });
});

describe("foldPortions", () => {
  it("puts the portions back on one line, exactly", () => {
    const unfolded = unfoldItem([{ label: "Beer", amount: "9.01", quantity: 3 }], 0, "EUR")!;
    const folded = foldPortions(unfolded.items, 0, 3, "EUR")!;
    expect(folded.items).toEqual([{ label: "Beer", amount: "9.01", quantity: 3, portionOf: null }]);
  });

  it("round-trips a line unfolded and merged back", () => {
    const before = [{ label: "Soup", amount: "3.00" }, { label: "Salad", amount: "9.00", quantity: 2 }];
    const unfolded = unfoldItem(before, 1, "EUR")!;
    const folded = foldPortions(unfolded.items, 1, 2, "EUR")!;
    expect(folded.items).toEqual([
      { label: "Soup", amount: "3.00" },
      { label: "Salad", amount: "9.00", quantity: 2, portionOf: null },
    ]);
  });

  it("refuses to merge fewer than two rows, or unreadable ones", () => {
    expect(foldPortions([{ label: "Soup", amount: "3.00" }], 0, 1, "EUR")).toBeNull();
    expect(foldPortions([{ label: "A", amount: "1.00" }, { label: "A", amount: "??" }], 0, 2, "EUR")).toBeNull();
    expect(foldPortions([], 0, 2, "EUR")).toBeNull();
  });
});

describe("portions", () => {
  const p = (n: number) => ({ label: "Salad", amount: "4.50", portionOf: n });

  it("marks each row of a run with its place in it", () => {
    expect(portions([{ label: "Soup", amount: "3.00" }, p(2), p(2)])).toEqual([
      null,
      { start: 1, index: 1, of: 2 },
      { start: 1, index: 2, of: 2 },
    ]);
  });

  it("keeps two adjacent unfolds of the same line apart", () => {
    // Four identical rows marked "one of two" are two separate pairs — the
    // merge control on the third row must not swallow the first pair.
    expect(portions([p(2), p(2), p(2), p(2)]).map((x) => x?.start)).toEqual([0, 0, 2, 2]);
  });

  it("treats a broken run as ordinary lines", () => {
    // A row deleted out from under a group, or a receipt that printed the
    // same label twice by itself: no bracket, no merge control.
    expect(portions([p(2)])).toEqual([null]);
    expect(portions([p(2), { label: "Wine", amount: "4.50", portionOf: 2 }])).toEqual([null, null]);
    expect(portions([{ label: "Salad", amount: "4.50" }, { label: "Salad", amount: "4.50" }]))
      .toEqual([null, null]);
  });
});

describe("receiptBreakdown", () => {
  const bill = [
    { label: "Beer", amount: "4.00", quantity: 2 },
    { label: "Fries", amount: "3.00" },
    { label: "Fries", amount: "3.00" },
  ];

  it("gives each person their own copy of the bill", () => {
    const { lines } = receiptBreakdown(
      bill,
      [new Set(["a"]), new Set(["a"]), new Set(["a", "b"])],
      null, "EUR", "seed",
    );
    expect(lines["a"]).toEqual([
      // Two printed beers, all a's: "Beer ×2".
      { label: "Beer", count: { n: 2, d: 1 }, minor: 400 },
      // One order of fries and half of another: "Fries ×1 1/2".
      { label: "Fries", count: { n: 3, d: 2 }, minor: 450 },
    ]);
    expect(lines["b"]).toEqual([{ label: "Fries", count: { n: 1, d: 2 }, minor: 150 }]);
  });

  it("counts a shared line as the fraction it was", () => {
    const { lines } = receiptBreakdown(
      [{ label: "Tagine", amount: "30.00" }],
      [new Set(["a", "b", "c"])],
      null, "EUR", "seed",
    );
    expect(lines["a"]).toEqual([{ label: "Tagine", count: { n: 1, d: 3 }, minor: 1000 }]);
  });

  it("does not multiply a printed count out over the people sharing it", () => {
    // "Fries ×2" shared by two is one order of fries each, not two.
    const { lines } = receiptBreakdown(
      [{ label: "Fries", amount: "6.00", quantity: 2 }],
      [new Set(["a", "b"])],
      null, "EUR", "seed",
    );
    expect(lines["a"]).toEqual([{ label: "Fries", count: { n: 1, d: 1 }, minor: 300 }]);
  });

  it("counts a portion of an unfolded line as one", () => {
    // The printed count became the rows; each row is one of the thing.
    const { lines } = receiptBreakdown(
      [{ label: "Salade", amount: "9.00", quantity: null, portionOf: 2 },
        { label: "Salade", amount: "9.00", quantity: null, portionOf: 2 }],
      [new Set(["a"]), new Set(["a", "b"])],
      null, "EUR", "seed",
    );
    expect(lines["a"]).toEqual([{ label: "Salade", count: { n: 3, d: 2 }, minor: 1350 }]);
  });

  it("keeps the tip as its own line, charged but not ordered", () => {
    const { lines } = receiptBreakdown(
      [{ label: "Beer", amount: "10.00" }],
      [new Set(["a"])],
      { amount: "2.00", members: new Set(["a"]) },
      "EUR", "seed",
    );
    expect(lines["a"]).toEqual([
      { label: "Beer", count: { n: 1, d: 1 }, minor: 1000 },
      { label: "", tip: true, count: { n: 1, d: 1 }, minor: 200 },
    ]);
  });

  it("adds up to exactly what the split is derived from", () => {
    const assignments = [new Set(["a", "b", "c"]), new Set(["b"]), new Set(["a", "c"])];
    const tip = { amount: "1.37", members: new Set(["a", "b", "c"]) };
    const { weights, lines } = receiptBreakdown(
      [{ label: "Tagine", amount: "10.00" }, { label: "Tea", amount: "3.33" },
        { label: "Fries", amount: "5.55" }],
      assignments, tip, "EUR", "seed",
    );
    for (const [id, own] of Object.entries(lines)) {
      expect(own.reduce((sum, l) => sum + l.minor, 0)).toBe(weights[id]);
    }
    // And nothing of the bill goes missing on the way.
    expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBe(1000 + 333 + 555 + 137);
  });

  it("is the same arithmetic weightsFromItems reports", () => {
    const assignments = [new Set(["a", "b"]), new Set(["b"]), new Set(["a", "b"])];
    const tip = { amount: "2.50", members: new Set(["a", "b"]) };
    expect(receiptBreakdown(bill, assignments, tip, "EUR", "seed").weights)
      .toEqual(weightsFromItems(bill, assignments, tip, "EUR", "seed"));
  });
});
