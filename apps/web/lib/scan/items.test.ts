import { describe, expect, it } from "vitest";
import { parseMinor } from "@hajsik/core";
import { handOffReceiptTotal, receiptTotalMinor, weightsFromItems } from "./items";

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
