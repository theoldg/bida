import { describe, expect, it } from "vitest";
import type { ReceiptItem } from "@bida/core";
import {
  billFromRows, blankRow, otherName, rowIsBad, rowIsEmpty, rowMinor, rowsFromBill, rowsFromExtras, setCount, setTotal,
  setUnit,
} from "./manual";
import { unfoldAll } from "./items";

const named = (label: string) => ({ ...blankRow(), label });

describe("a row's price", () => {
  it("multiplies a typed unit by the count, in minor units", () => {
    const row = setCount(setUnit(named("Beer"), "3.10", "EUR"), 3, "EUR");
    expect(rowMinor(row, "EUR")).toBe(930);
    expect(row.totalText).toBe("9.30");
  });

  it("keeps a typed total exact and shows the unit rounded", () => {
    const row = setTotal(setCount(named("Salad"), 3, "EUR"), "10.00", "EUR");
    expect(rowMinor(row, "EUR")).toBe(1000);
    expect(row.unitText).toBe("3.33");
  });

  it("steps a single item as one more at its price", () => {
    const row = setCount(setTotal(named("a"), "12", "EUR"), 4, "EUR");
    expect(row.by).toBe("unit");
    expect(row.totalText).toBe("48.00");
  });

  it("holds the typed figure still when the count moves", () => {
    const unit = setCount(setCount(setUnit(named("a"), "2", "EUR"), 4, "EUR"), 2, "EUR");
    expect(unit.unitText).toBe("2");
    expect(unit.totalText).toBe("4.00");
    const total = setCount(setTotal(setCount(named("a"), 2, "EUR"), "12", "EUR"), 4, "EUR");
    expect(total.totalText).toBe("12");
    expect(total.unitText).toBe("3.00");
  });

  it("works in currencies without and with three decimals", () => {
    expect(rowMinor(setCount(setUnit(named("a"), "150", "JPY"), 3, "JPY"), "JPY")).toBe(450);
    const kwd = setTotal(setCount(named("a"), 3, "KWD"), "1.000", "KWD");
    expect(rowMinor(kwd, "KWD")).toBe(1000);
    expect(kwd.unitText).toBe("0.333");
  });

  it("clamps the count to 1..100", () => {
    expect(setCount(named("a"), 0, "EUR").count).toBe(1);
    expect(setCount(named("a"), 500, "EUR").count).toBe(100);
  });
});

describe("which rows are lines", () => {
  it("drops an untouched row and refuses a half-filled one", () => {
    expect(rowIsEmpty(blankRow())).toBe(true);
    expect(rowIsBad(blankRow(), "EUR")).toBe(false);
    expect(rowIsBad(named("Tea"), "EUR")).toBe(true);
    expect(rowIsBad(setTotal(blankRow(), "3", "EUR"), "EUR")).toBe(true);
    expect(rowIsBad(setTotal(named("Tea"), "0", "EUR"), "EUR")).toBe(true);
    expect(rowIsBad(setTotal(named("Tea"), "3", "EUR"), "EUR")).toBe(false);
  });
});

describe("rows and the draft's bill", () => {
  const bill: ReceiptItem[] = unfoldAll([
    { label: "Soda", labelEn: "Soda", amount: "9.00", quantity: 3 },
    { label: "Tagine", labelEn: "Lamb stew", amount: "14.50", quantity: null, portionOf: null },
  ], "EUR").items;

  it("opens folded, and saves back to the same bill untouched", () => {
    const rows = rowsFromBill(bill, "EUR", false);
    expect(rows.map((r) => [r.label, r.count, r.totalText, r.unitText]))
      .toEqual([["Soda", 3, "9.00", "3.00"], ["Tagine", 1, "14.50", "14.50"]]);
    const back = billFromRows(rows, { items: bill, assignments: null }, "EUR");
    expect(back.items).toEqual(bill);
    expect(back.totalMinor).toBe(2350);
  });

  it("opens a line that doesn't divide on its printed total", () => {
    const [salad] = rowsFromBill(unfoldAll([{ label: "Salad", amount: "10.00", quantity: 3 }], "EUR").items, "EUR", false);
    expect(salad).toMatchObject({ by: "total", totalText: "10.00", unitText: "3.33" });
    expect(rowMinor(setCount(salad!, 4, "EUR"), "EUR")).toBe(1000);
  });

  it("forgets a translation once the label is retyped", () => {
    const [soda, tagine] = rowsFromBill(bill, "EUR", false);
    const back = billFromRows([soda!, { ...tagine!, label: "Couscous" }], { items: bill, assignments: null }, "EUR");
    expect(back.items.at(-1)).toMatchObject({ label: "Couscous", labelEn: null });
  });

  it("names each line as the bill is read, with the other name under it until retyped", () => {
    const printed = rowsFromBill(bill, "EUR", false);
    expect(printed.map((r) => [r.label, otherName(r)])).toEqual([["Soda", null], ["Tagine", "Lamb stew"]]);
    const english = rowsFromBill(bill, "EUR", true);
    expect(english.map((r) => [r.label, otherName(r)])).toEqual([["Soda", null], ["Lamb stew", "Tagine"]]);
    expect(otherName({ ...english[1]!, label: "Lamb stew " })).toBe("Tagine");
    expect(otherName({ ...english[1]!, label: "Beef stew" })).toBeNull();
  });

  it("saves an untouched English name back as both, and a typed one as the only name", () => {
    const [soda, stew] = rowsFromBill(bill, "EUR", true);
    expect(billFromRows([soda!, stew!], { items: bill, assignments: null }, "EUR").items).toEqual(bill);
    const typed = billFromRows([soda!, { ...stew!, label: "Beef stew" }], { items: bill, assignments: null }, "EUR");
    expect(typed.items.at(-1)).toMatchObject({ label: "Beef stew", labelEn: null });
    const back = billFromRows([soda!, { ...stew!, label: "Lamb stew" }], { items: bill, assignments: null }, "EUR");
    expect(back.items.at(-1)).toMatchObject({ label: "Tagine", labelEn: "Lamb stew" });
  });

  it("carries who had a line through a rename, a reprice and a new count", () => {
    const assignments = [["a"], ["a"], ["a"], ["b", "c"]];
    const [soda, tagine] = rowsFromBill(bill, "EUR", false);
    const rows = [setCount(soda!, 2, "EUR"), setTotal({ ...tagine!, label: "Stew" }, "15", "EUR"), setTotal(named("Bread"), "2", "EUR")];
    const back = billFromRows(rows, { items: bill, assignments }, "EUR");
    expect(back.items.map((i) => i.amount)).toEqual(["3.00", "3.00", "15.00", "2.00"]);
    expect(back.assignments).toEqual([["a"], ["a"], ["b", "c"], []]);
  });

  it("keeps portions apart while their count holds, and drops them when it moves", () => {
    const assignments = [["a"], ["b"], ["c"], []];
    const [soda, tagine] = rowsFromBill(bill, "EUR", false);
    expect(billFromRows([soda!, tagine!], { items: bill, assignments }, "EUR").assignments)
      .toEqual([["a"], ["b"], ["c"], []]);
    expect(billFromRows([setCount(soda!, 4, "EUR")], { items: bill, assignments }, "EUR").assignments)
      .toEqual([[], [], [], []]);
  });

  it("follows a line that moved when one above it was removed", () => {
    const assignments = [["a"], ["a"], ["a"], ["b"]];
    const [, tagine] = rowsFromBill(bill, "EUR", false);
    expect(billFromRows([tagine!], { items: bill, assignments }, "EUR").assignments).toEqual([["b"]]);
  });
});

describe("a line's kind", () => {
  const bill: ReceiptItem[] = unfoldAll([
    { label: "Soda", labelEn: null, amount: "9.00", quantity: 3 },
    { label: "Tagine", labelEn: null, amount: "14.50", quantity: null, portionOf: null },
  ], "EUR").items;
  const extras = {
    discounts: [{ label: "2 pour 1", labelEn: "2 for 1", amount: "4.00" }],
    charges: [{ label: "", amount: "1.30" }, { label: "Service", amount: "2.00" }],
  };

  it("opens the discounts, then the charges, after the items, naming an unnamed charge", () => {
    const rows = rowsFromExtras(extras, true, "Tax");
    expect(rows.map((r) => [r.kind, r.label, r.totalText])).toEqual([
      ["discount", "2 for 1", "4.00"], ["charge", "Tax", "1.30"], ["charge", "Service", "2.00"],
    ]);
  });

  it("saves each kind to its own list, untouched names as they were", () => {
    const rows = [...rowsFromBill(bill, "EUR", false), ...rowsFromExtras(extras, false, "Tax")];
    const back = billFromRows(rows, { items: bill, assignments: null }, "EUR");
    expect(back.items).toEqual(bill);
    expect(back.discounts).toEqual([{ label: "2 pour 1", labelEn: "2 for 1", amount: "4.00" }]);
    // Still unnamed, so it keeps the seed it was saved under (`billCharges`).
    expect(back.charges).toEqual([
      { label: "", labelEn: null, amount: "1.30" }, { label: "Service", labelEn: null, amount: "2.00" },
    ]);
  });

  it("drops a line's eaters while it is a discount, and gives them back when it is an item again", () => {
    const assignments = [["a"], ["a"], ["a"], ["b"]];
    const [soda, tagine] = rowsFromBill(bill, "EUR", false);
    const off = billFromRows([soda!, { ...tagine!, kind: "discount" }], { items: bill, assignments }, "EUR");
    expect(off.items.map((i) => i.label)).toEqual(["Soda", "Soda", "Soda"]);
    expect(off.discounts.map((d) => d.amount)).toEqual(["14.50"]);
    const back = billFromRows([soda!, { ...tagine!, kind: "item" }], { items: bill, assignments }, "EUR");
    expect(back.assignments).toEqual(assignments);
  });

  it("prices a counted item made a charge at the whole line, and keeps its count to change back", () => {
    const [soda] = rowsFromBill(bill, "EUR", false);
    const charge = { ...soda!, kind: "charge" as const };
    expect(billFromRows([charge], { items: [], assignments: null }, "EUR").charges[0]!.amount).toBe("9.00");
    expect(billFromRows([{ ...charge, kind: "item" }], { items: [], assignments: null }, "EUR").items)
      .toHaveLength(3);
  });
});
