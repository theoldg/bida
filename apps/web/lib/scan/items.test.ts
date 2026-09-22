import { describe, expect, it } from "vitest";
import {
  demoOps, foldOps, parseMinor, receiptExtras, DEMO_GROUP_ID, type BillExtras, type ReceiptItem,
} from "@bida/core";
import {
  billCharges, billExtrasIn, billLabel, billLabels, foldedLine, hasTranslation, handOffReceiptTotal, portions, receiptBreakdown, receiptTotalMinor,
  runAssignment,
  unfoldItem,
  unfoldableInto, weightsFromItems,
} from "./items";

/** The three bill-level lines, named one at a time. */
const extras = (some: Partial<BillExtras> = {}): BillExtras =>
  ({ tip: null, tax: null, discounts: [], ...some });
/** One deduction, named or not. */
const off = (amount: string, label = "") => ({ label, amount });
const table = (...ids: string[]) => new Set(ids);

describe("weightsFromItems", () => {
  it("splits each item evenly among its assigned members", () => {
    const weights = weightsFromItems(
      [{ amount: "10.00" }],
      [new Set(["a", "b"])],
      null,
      table("a", "b"),
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
      extras({ tip: "4.00" }),
      table("a", "b"),
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
      extras({ tip: "4.00" }),
      table("a", "b"),
      "EUR",
      "seed",
    );
    expect(weights["a"]! + weights["b"]!).toBe(400);
    expect(weights["a"]).toBe(200);
    expect(weights["b"]).toBe(200);
  });

  it("gives someone who ordered nothing no share of the tip", () => {
    // "c" is marked present (so they are at the table) but had no items — a
    // proportional tip should give them nothing, same as their item total.
    const weights = weightsFromItems(
      [{ amount: "20.00" }],
      [new Set(["a"])],
      extras({ tip: "4.00" }),
      table("a", "c"),
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
      extras({ tip: "1.50" }),
      "EUR",
    )).toBe(1700);
  });

  it("adds the tax on and takes the discounts off", () => {
    expect(receiptTotalMinor(
      [{ amount: "10.00" }, { amount: "5.50" }],
      extras({ tip: "1.50", tax: "2.00", discounts: [off("4.00")] }),
      "EUR",
    )).toBe(1500);
  });

  it("is null when there's a tip but no readable items", () => {
    expect(receiptTotalMinor([], extras({ tip: "1.50" }), "EUR")).toBeNull();
  });

  it("skips a line item it can't parse rather than throwing", () => {
    expect(receiptTotalMinor(
      [{ amount: "not a number" }, { amount: "10.00" }],
      null,
      "EUR",
    )).toBe(1000);
  });

  it("ignores an unparsable tip but keeps the items", () => {
    expect(receiptTotalMinor([{ amount: "10.00" }], extras({ tip: "garbage" }), "EUR")).toBe(1000);
  });
});

describe("handOffReceiptTotal", () => {
  it("pins the derived total when leaving Receipt for an arithmetic tab", () => {
    // The bug this exists for: Receipt derives its total and never stores it,
    // so switching to Evenly fell back to a blank `amountText` and the
    // expense silently became worth zero — a greyed-out Save, and
    // "€0.00 of €0.00 allocated" one more tap along.
    expect(handOffReceiptTotal(
      "receipt", "equal", [{ amount: "30.00" }, { amount: "10.00" }], extras({ tip: "4.00" }), "EUR",
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
    expect(handOffReceiptTotal("receipt", "equal", undefined, null, "EUR")).toBeNull();
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

describe("foldedLine", () => {
  it("reads the portions as the one line they came from, exactly", () => {
    const unfolded = unfoldItem([{ label: "Beer", amount: "9.01", quantity: 3 }], 0, "EUR")!;
    expect(foldedLine(unfolded.items, 0, 3, "EUR"))
      .toEqual({ label: "Beer", amount: "9.01", quantity: 3, portionOf: null });
  });

  it("reads a run in the middle of a bill without touching the rest", () => {
    const before = [{ label: "Soup", amount: "3.00" }, { label: "Salad", amount: "9.00", quantity: 2 }];
    const unfolded = unfoldItem(before, 1, "EUR")!;
    expect(foldedLine(unfolded.items, 1, 2, "EUR"))
      .toEqual({ label: "Salad", amount: "9.00", quantity: 2, portionOf: null });
    // The bill itself is untouched: folding is a view, not an edit.
    expect(unfolded.items).toHaveLength(3);
  });

  it("has no line to show for fewer than two rows, or unreadable ones", () => {
    expect(foldedLine([{ label: "Soup", amount: "3.00" }], 0, 1, "EUR")).toBeNull();
    expect(foldedLine([{ label: "A", amount: "1.00" }, { label: "A", amount: "??" }], 0, 2, "EUR")).toBeNull();
    expect(foldedLine([], 0, 2, "EUR")).toBeNull();
  });
});

describe("which language a bill is read in", () => {
  const tagine: ReceiptItem = { label: "Tajine", labelEn: "Lamb stew", amount: "14.50" };
  const tea: ReceiptItem = { label: "The a la menthe", labelEn: null, amount: "6.50" };

  it("shows the bill as printed by default", () => {
    expect(billLabel(tagine, false)).toBe("Tajine");
    expect(billLabels([tagine, tea], false)).toEqual([tagine, tea]);
  });

  it("shows the English where the model had some", () => {
    expect(billLabel(tagine, true)).toBe("Lamb stew");
    expect(billLabels([tagine, tea], true).map((l) => l.label)).toEqual(["Lamb stew", "The a la menthe"]);
  });

  // A line the model left untranslated would otherwise come back blank, which
  // is the one way this could lose something the receipt actually said.
  it("falls back to the printed label rather than showing a gap", () => {
    expect(billLabel({ label: "Cafe", labelEn: "" }, true)).toBe("Cafe");
    expect(billLabel({ label: "Cafe" }, true)).toBe("Cafe");
  });

  it("relabels a deduction without touching the tip or the tax", () => {
    const some = extras({ tip: "3.00", tax: "1.00", discounts: [{ label: "2 pour 1", labelEn: "2 for 1", amount: "4.00" }] });
    const shown = billExtrasIn(some, true);
    expect(shown.discounts.map((d) => d.label)).toEqual(["2 for 1"]);
    expect(shown.tip).toBe("3.00");
    expect(shown.tax).toBe("1.00");
  });

  // What decides whether the toggle is drawn at all: a bill already in English
  // has nothing to switch to, and the control would do nothing.
  it("knows when there is nothing to translate", () => {
    expect(hasTranslation([tea], null)).toBe(false);
    expect(hasTranslation<ReceiptItem>([{ label: "Beer", labelEn: "Beer", amount: "5.00" }])).toBe(false);
    expect(hasTranslation([tea], [{ label: "Remise", labelEn: "Discount", amount: "4.00" }])).toBe(true);
    expect(hasTranslation([tea, tagine])).toBe(true);
  });
});

describe("runAssignment", () => {
  const sets = (...rows: string[][]) => rows.map((r) => new Set(r));

  it("is not detailed while everybody has all of it or none of it", () => {
    const { detailed, marks } = runAssignment(sets(["a", "b"], ["a", "b"]));
    expect(detailed).toBe(false);
    expect([...marks]).toEqual([["a", "all"], ["b", "all"]]);
  });

  it("has nothing to show for a run nobody has been given", () => {
    expect(runAssignment(sets([], []))).toEqual({ detailed: false, marks: new Map() });
  });

  it("is detailed as soon as one person has some and not the others", () => {
    const { detailed, marks } = runAssignment(sets(["a"], ["b"]));
    expect(detailed).toBe(true);
    expect([...marks]).toEqual([["a", "some"], ["b", "some"]]);
  });

  it("marks the person who had all of a detailed run the same split way", () => {
    // Nothing in such a row may look like an ordinary assignment: none of it
    // can be tapped like one.
    const { marks } = runAssignment(sets(["a", "b"], ["a"], ["a"]));
    expect([...marks]).toEqual([["a", "some"], ["b", "some"]]);
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
      null, table(), "EUR", "seed",
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
      null, table(), "EUR", "seed",
    );
    expect(lines["a"]).toEqual([{ label: "Tagine", count: { n: 1, d: 3 }, minor: 1000 }]);
  });

  it("does not multiply a printed count out over the people sharing it", () => {
    // "Fries ×2" shared by two is one order of fries each, not two.
    const { lines } = receiptBreakdown(
      [{ label: "Fries", amount: "6.00", quantity: 2 }],
      [new Set(["a", "b"])],
      null, table(), "EUR", "seed",
    );
    expect(lines["a"]).toEqual([{ label: "Fries", count: { n: 1, d: 1 }, minor: 300 }]);
  });

  it("counts a portion of an unfolded line as one", () => {
    // The printed count became the rows; each row is one of the thing.
    const { lines } = receiptBreakdown(
      [{ label: "Salade", amount: "9.00", quantity: null, portionOf: 2 },
        { label: "Salade", amount: "9.00", quantity: null, portionOf: 2 }],
      [new Set(["a"]), new Set(["a", "b"])],
      null, table(), "EUR", "seed",
    );
    expect(lines["a"]).toEqual([{ label: "Salade", count: { n: 3, d: 2 }, minor: 1350 }]);
  });

  it("keeps the tip as its own line, charged but not ordered", () => {
    const { lines } = receiptBreakdown(
      [{ label: "Beer", amount: "10.00" }],
      [new Set(["a"])],
      extras({ tip: "2.00" }),
      table("a"), "EUR", "seed",
    );
    expect(lines["a"]).toEqual([
      { label: "Beer", count: { n: 1, d: 1 }, minor: 1000 },
      { label: "", extra: "tip", count: { n: 1, d: 1 }, minor: 200 },
    ]);
  });

  it("adds up to exactly what the split is derived from", () => {
    const assignments = [new Set(["a", "b", "c"]), new Set(["b"]), new Set(["a", "c"])];
    const { weights, lines } = receiptBreakdown(
      [{ label: "Tagine", amount: "10.00" }, { label: "Tea", amount: "3.33" },
        { label: "Fries", amount: "5.55" }],
      assignments, extras({ tip: "1.37" }), table("a", "b", "c"), "EUR", "seed",
    );
    for (const [id, own] of Object.entries(lines)) {
      expect(own.reduce((sum, l) => sum + l.minor, 0)).toBe(weights[id]);
    }
    // And nothing of the bill goes missing on the way.
    expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBe(1000 + 333 + 555 + 137);
  });

  it("is the same arithmetic weightsFromItems reports", () => {
    const assignments = [new Set(["a", "b"]), new Set(["b"]), new Set(["a", "b"])];
    const tip = extras({ tip: "2.50" });
    expect(receiptBreakdown(bill, assignments, tip, table("a", "b"), "EUR", "seed").weights)
      .toEqual(weightsFromItems(bill, assignments, tip, table("a", "b"), "EUR", "seed"));
  });
});

describe("bill extras", () => {
  // "Buy 1 get 1 free": two pizzas and a credit for the cheaper. The credit
  // comes off both in the ratio ordered — the same rule as a whole-bill
  // discount, so there is one rule, not two.
  it("takes a two-for-one off both pizzas in proportion", () => {
    const weights = weightsFromItems(
      [{ amount: "10.00" }, { amount: "8.00" }],
      [new Set(["a"]), new Set(["b"])],
      extras({ discounts: [off("8.00")] }),
      table("a", "b"),
      "EUR",
      "seed",
    );
    expect(weights["a"]).toBe(556);
    expect(weights["b"]).toBe(444);
    expect(weights["a"]! + weights["b"]!).toBe(1000);
  });

  // What makes a proportional discount safe: it scales everybody by the same
  // factor, so who owes more than whom is exactly as the bill left it.
  it("leaves the ratio between people where the items put it", () => {
    const items = [{ amount: "30.00" }, { amount: "10.00" }];
    const assignments = [new Set(["a"]), new Set(["b"])];
    const gross = weightsFromItems(items, assignments, null, table("a", "b"), "EUR", "seed");
    const net = weightsFromItems(
      items, assignments, extras({ discounts: [off("10.00")] }), table("a", "b"), "EUR", "seed");
    expect(gross["a"]! / gross["b"]!).toBeCloseTo(net["a"]! / net["b"]!, 6);
    expect(net["a"]! + net["b"]!).toBe(3000);
  });

  it("spreads the tax the same way, and adds it rather than taking it off", () => {
    const weights = weightsFromItems(
      [{ amount: "30.00" }, { amount: "10.00" }],
      [new Set(["a"]), new Set(["b"])],
      extras({ tax: "4.00" }),
      table("a", "b"),
      "EUR",
      "seed",
    );
    expect(weights["a"]).toBe(3300);
    expect(weights["b"]).toBe(1100);
  });

  // The reason the extras divide by a snapshot of the item weights: a tip must
  // not decide how much of the tax is yours, nor the tax how much of the tip.
  it("divides every extra by what was ordered, never by another extra", () => {
    const one = weightsFromItems(
      [{ amount: "30.00" }, { amount: "10.00" }],
      [new Set(["a"]), new Set(["b"])],
      extras({ tip: "4.00", tax: "4.00", discounts: [off("4.00")] }),
      table("a", "b"), "EUR", "seed",
    );
    // 3:1 throughout — 3000 + 300 + 300 − 300, and a quarter of that for "b".
    expect(one["a"]).toBe(3300);
    expect(one["b"]).toBe(1100);
  });

  it("gives each deduction its own line, by the name the bill gave it", () => {
    const { lines } = receiptBreakdown(
      [{ label: "Pizza", amount: "10.00" }],
      [new Set(["a"])],
      extras({ discounts: [off("2.00", "2 for 1"), off("0.50", "Loyalty")] }),
      table("a"), "EUR", "seed",
    );
    expect(lines["a"]).toEqual([
      { label: "Pizza", count: { n: 1, d: 1 }, minor: 1000 },
      { label: "2 for 1", extra: "discount", count: { n: 1, d: 1 }, minor: -200 },
      { label: "Loyalty", extra: "discount", count: { n: 1, d: 1 }, minor: -50 },
    ]);
  });

  it("spreads several deductions to the same total as one pooled figure", () => {
    const items = [{ amount: "10.00" }, { amount: "8.00" }, { amount: "3.33" }];
    const assignments = [new Set(["a"]), new Set(["b"]), new Set(["a", "b"])];
    const apart = weightsFromItems(
      items, assignments, extras({ discounts: [off("4.00"), off("1.25")] }),
      table("a", "b"), "EUR", "seed");
    const summed = Object.values(apart).reduce((x, y) => x + y, 0);
    expect(summed).toBe(1000 + 800 + 333 - 400 - 125);
  });

  it("rules the deductions off before the tax and the tip, as a bill does", () => {
    expect(billCharges(extras({ tip: "1.00", tax: "2.00", discounts: [off("3.00", "Loyalty")] })))
      .toEqual([
        { kind: "discount", label: "Loyalty", amount: "3.00", seed: "discount0" },
        { kind: "tax", label: "", amount: "2.00", seed: "tax" },
        { kind: "tip", label: "", amount: "1.00", seed: "tip" },
      ]);
    expect(billCharges(null)).toEqual([]);
  });

  // The invariant the whole screen rests on: what the grid quotes each person
  // is what the bill is worth, to the cent, extras and rounding included.
  it("adds up to the bill's own total, extras and all", () => {
    const items = [{ amount: "10.00" }, { amount: "3.33" }, { amount: "5.55" }];
    const assignments = [new Set(["a", "b", "c"]), new Set(["b"]), new Set(["a", "c"])];
    const all = extras({ tip: "1.37", tax: "0.99", discounts: [off("2.22")] });
    const { weights, lines } = receiptBreakdown(
      items, assignments, all, table("a", "b", "c"), "EUR", "seed");

    expect(Object.values(weights).reduce((x, y) => x + y, 0))
      .toBe(receiptTotalMinor(items, all, "EUR"));
    // And a person's lines still add up to their own row, credit included.
    for (const [id, own] of Object.entries(lines)) {
      expect(own.reduce((sum, l) => sum + l.minor, 0)).toBe(weights[id]);
    }
  });

  it("leaves nobody owing less than nothing when a discount swallows the bill", () => {
    // `checkScan` refuses such a receipt outright; this is the floor under a
    // bill edited into that state by hand.
    const weights = weightsFromItems(
      [{ amount: "10.00" }],
      [new Set(["a"])],
      extras({ discounts: [off("25.00")] }),
      table("a"), "EUR", "seed",
    );
    expect(weights["a"]).toBeUndefined();
  });

  it("splits an extra evenly while nobody has been assigned anything", () => {
    const weights = weightsFromItems(
      [{ amount: "10.00" }], [new Set()],
      extras({ tax: "4.00" }), table("a", "b"), "EUR", "seed",
    );
    expect(weights["a"]).toBe(200);
    expect(weights["b"]).toBe(200);
  });
});

/**
 * The demo's cantina tab carries a bill and the weights read off it (core/demo.ts),
 * and core cannot check the second against the first: `receiptBreakdown` is
 * the web's, and it is what the entry screen reopens the grid with. If the two
 * ever part, the demo shows one itemisation and charges another.
 */
describe("the demo's itemised cantina tab", () => {
  it("is priced by this file, to the cent", () => {
    const dinner = foldOps(demoOps({
      ids: { Luke: "m-luke", Han: "m-han", Chewie: "m-chewie", Ben: "m-ben" },
      colorSeeds: { Luke: 1, Han: 2, Chewie: 3, Ben: 4 },
      deviceNodeId: "node0001",
    }, Date.UTC(2026, 8, 18)).map((draft, i) => ({
      ...draft,
      id: `op-${i}`,
      groupId: DEMO_GROUP_ID,
      hlc: `2026-09-18T00:00:00.000Z-${String(i).padStart(4, "0")}-node0001`,
      actor: "m-luke",
      note: draft.note ?? null,
      createdAt: 0,
      seq: null,
    }))).expenses["demo-cantina"]!;

    expect(weightsFromItems(
      dinner.receiptItems!,
      (dinner.receiptAssignments ?? []).map((row) => new Set(row)),
      receiptExtras(dinner),
      new Set(dinner.receiptInvolved ?? []),
      dinner.currency,
      dinner.id,
    )).toEqual(dinner.split.mode === "receipt" ? dinner.split.weights : null);
  });
});
