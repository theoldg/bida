import { describe, expect, it } from "vitest";
import {
  billTotalMinor, checkScan, lineMinor, normalizeScan, readBill, receiptExtras, scanCurrency,
  type ScanDiscount, type ScanLineItem, type ScanResult,
} from "./scan.js";

// A Saturday afternoon, local: the scan's clock in every case below.
const NOW = new Date(2026, 8, 5, 14, 30, 7, 123).getTime();

const blank: ScanResult = {
  title: null, total: null, tip: null, tax: null, discounts: [],
  currency: null, date: null, lineItems: [], error: null,
};

describe("normalizeScan", () => {
  it("passes the model's normalized total through untouched", () => {
    expect(normalizeScan({ ...blank, total: "42.50" }, "EUR", NOW)).toMatchObject({ amountText: "42.50" });
  });

  it("passes a plain integer through untouched", () => {
    expect(normalizeScan({ ...blank, total: "620" }, "EUR", NOW)).toMatchObject({ amountText: "620" });
  });

  it("keeps a leading minus", () => {
    expect(normalizeScan({ ...blank, total: "-5.00" }, "EUR", NOW)).toMatchObject({ amountText: "-5.00" });
  });

  it("uppercases the currency", () => {
    expect(normalizeScan({ ...blank, currency: "eur" }, "EUR", NOW)).toMatchObject({ currency: "EUR" });
  });

  // Anything formatMinor would throw on has to be dropped, not repaired:
  // the form formats the draft's currency on every render.
  it.each(["\u20ac", "EU", "USDT", "12", "", "  "])(
    "drops a currency that isn't three letters: %j",
    (currency) => {
      expect(normalizeScan({ ...blank, currency }, "EUR", NOW)).not.toHaveProperty("currency");
    },
  );

  it("converts a printed date to local midnight, not UTC midnight", () => {
    const { occurredAt } = normalizeScan({ ...blank, date: "2026-08-28" }, "EUR", NOW);
    expect(occurredAt).toBe(new Date(2026, 7, 28).getTime());
  });

  // The whole point: whatever the offset, the day you read back is the day
  // that was printed on the receipt.
  it("reads the date back as the day that was printed", () => {
    const { occurredAt } = normalizeScan({ ...blank, date: "2026-04-04" }, "EUR", NOW);
    const back = new Date(occurredAt!);
    expect([back.getFullYear(), back.getMonth() + 1, back.getDate()]).toEqual([2026, 4, 4]);
  });

  // Midnight is this app's "day known, time not", so a receipt scanned on the
  // day it was printed must not claim it: the scan is the time.
  it("stamps a receipt printed today with the moment of the scan", () => {
    const today = new Date(NOW);
    const printed = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(normalizeScan({ ...blank, date: printed }, "EUR", NOW))
      .toMatchObject({ occurredAt: NOW, dateOnly: false });
  });

  // Midnight carries no meaning of its own now: a scan that happens to land on
  // it is a moment like any other, and the patch says so.
  it("keeps a receipt scanned in the millisecond of midnight as a moment", () => {
    const at = new Date(2026, 8, 5).getTime();
    expect(normalizeScan({ ...blank, date: "2026-09-05" }, "EUR", at))
      .toMatchObject({ occurredAt: at, dateOnly: false });
  });

  it("marks a backdated receipt as a day with no time, at midnight", () => {
    const { occurredAt, dateOnly } = normalizeScan({ ...blank, date: "2026-08-28" }, "EUR", NOW);
    const back = new Date(occurredAt!);
    expect([back.getHours(), back.getMinutes(), back.getSeconds(), back.getMilliseconds()])
      .toEqual([0, 0, 0, 0]);
    expect(dateOnly).toBe(true);
  });

  it("omits an unparseable date", () => {
    expect(normalizeScan({ ...blank, date: "last Tuesday" }, "EUR", NOW)).not.toHaveProperty("occurredAt");
  });

  // The title is the model's, adaptations and all — the prompt asks it to
  // strip what isn't the name and to say what was bought where the name alone
  // wouldn't. Nothing here second-guesses that; it lands as typed.
  it("passes the title through as the description", () => {
    expect(normalizeScan({ ...blank, title: "Lidl - barbecue" }, "EUR", NOW))
      .toMatchObject({ description: "Lidl - barbecue" });
  });

  it("omits fields the model couldn't read, tip and line items included", () => {
    expect(normalizeScan(blank, "EUR", NOW)).toEqual({});
  });

  it("doesn't fold tip or line items into the draft patch — the seam is unused today", () => {
    const result: ScanResult = {
      ...blank,
      total: "50.00",
      tip: "5.00",
      lineItems: [{ label: "Café", labelEn: "Coffee", amount: "3.50", unitAmount: null, quantity: null }],
    };
    expect(normalizeScan(result, "EUR", NOW)).toEqual({ amountText: "50.00" });
  });
});

describe("scanCurrency", () => {
  it("uses the scan's own currency when it is one we can count in", () => {
    expect(scanCurrency({ ...blank, currency: "mad" }, "EUR")).toBe("MAD");
  });

  it("falls back to the draft's when the model returned something else", () => {
    expect(scanCurrency({ ...blank, currency: "€" }, "EUR")).toBe("EUR");
    expect(scanCurrency(blank, "JPY")).toBe("JPY");
  });
});

/** A deduction, named. `off("8.00")` is one the receipt didn't label. */
const off = (amount: string, label = ""): ScanDiscount => ({ label, labelEn: null, amount });

/** `label`/`labelEn` play no part in the arithmetic; every line here is a number. */
const line = (amount: string): ScanLineItem =>
  ({ label: "x", labelEn: null, amount, unitAmount: null, quantity: null });

/** The other way a line states its cost: so many, at so much each. */
const each = (unitAmount: string, quantity: number): ScanLineItem =>
  ({ label: "x", labelEn: null, amount: null, unitAmount, quantity });

describe("checkScan", () => {
  it("accepts a receipt that is only a total", () => {
    expect(checkScan({ ...blank, total: "42.50" }, "EUR")).toBeNull();
  });

  it("accepts lines that add up to the total", () => {
    const result = { ...blank, total: "30.00", lineItems: [line("12.50"), line("17.50")] };
    expect(checkScan(result, "EUR")).toBeNull();
  });

  it("accepts lines plus a tip that add up to the total", () => {
    const result = { ...blank, total: "33.00", tip: "3.00", lineItems: [line("12.50"), line("17.50")] };
    expect(checkScan(result, "EUR")).toBeNull();
  });

  // A promotional line really is free, and it takes no share of anything —
  // which is exactly what a zero weight does downstream.
  it("accepts a free line", () => {
    const result = { ...blank, total: "12.50", lineItems: [line("12.50"), line("0.00")] };
    expect(checkScan(result, "EUR")).toBeNull();
  });

  it("counts in the currency's own exponent, not in cents", () => {
    expect(checkScan({ ...blank, total: "800", lineItems: [line("500"), line("300")] }, "JPY")).toBeNull();
    const tnd = { ...blank, total: "8.750", lineItems: [line("5.500"), line("3.250")] };
    expect(checkScan(tnd, "TND")).toBeNull();
  });

  it.each([null, "", "  ", "abc", "1,234.50"])("refuses a total it can't read: %j", (total) => {
    expect(checkScan({ ...blank, total }, "EUR")).toBe("no-total");
  });

  it.each(["0", "0.00", "-5.00"])("refuses a total of %j — that isn't a bill", (total) => {
    expect(checkScan({ ...blank, total }, "EUR")).toBe("mismatch");
  });

  it("refuses a line it can't read, even when the total is fine", () => {
    const result = { ...blank, total: "30.00", lineItems: [line("12.50"), line("17,50 EUR")] };
    expect(checkScan(result, "EUR")).toBe("unreadable-line");
  });

  it("refuses a tip it can't read", () => {
    expect(checkScan({ ...blank, total: "30.00", tip: "n/a" }, "EUR")).toBe("unreadable-line");
  });

  it("refuses a discount it can't read", () => {
    expect(checkScan({ ...blank, total: "30.00", discounts: [off("half off")] }, "EUR"))
      .toBe("unreadable-line");
  });

  it("accepts a bill-level discount the total accounts for", () => {
    const result = { ...blank, total: "25.00", discounts: [off("5.00")], lineItems: [line("30.00")] };
    expect(checkScan(result, "EUR")).toBeNull();
  });

  it("accepts a deduction printed as a negative line", () => {
    const result = { ...blank, total: "25.00", lineItems: [line("30.00"), line("-5.00")] };
    expect(checkScan(result, "EUR")).toBeNull();
  });

  // The "buy 1 get 1 free" the owner asked about: two pizzas and the cheaper
  // one credited back. It reconciles, and `readBill` pools the credit.
  it("accepts a buy-one-get-one credit", () => {
    const result = {
      ...blank, total: "10.00", discounts: [off("8.00", "2 for 1")],
      lineItems: [line("10.00"), line("8.00")],
    };
    expect(checkScan(result, "EUR")).toBeNull();
  });

  it("accepts tax charged on top of the lines", () => {
    const result = { ...blank, total: "33.00", tax: "3.00", lineItems: [line("12.50"), line("17.50")] };
    expect(checkScan(result, "EUR")).toBeNull();
  });

  it("refuses a discount counted twice — once as a line and once in the field", () => {
    const result = {
      ...blank, total: "25.00", discounts: [off("5.00")], lineItems: [line("30.00"), line("-5.00")],
    };
    expect(checkScan(result, "EUR")).toBe("mismatch");
  });

  it("refuses a discount worth more than the bill it comes off", () => {
    const result = { ...blank, total: "-5.00", discounts: [off("35.00")], lineItems: [line("30.00")] };
    expect(checkScan(result, "EUR")).toBe("mismatch");
  });

  // The whole point of the check: one missed line is the failure that prices
  // the grid against a total the receipt never printed.
  it.each(["29.99", "30.01", "35.00"])("refuses lines that miss the total by any amount: %j", (total) => {
    const result = { ...blank, total, lineItems: [line("12.50"), line("17.50")] };
    expect(checkScan(result, "EUR")).toBe("mismatch");
  });

  it("refuses lines that add up only if the tip is ignored", () => {
    const result = { ...blank, total: "30.00", tip: "3.00", lineItems: [line("12.50"), line("17.50")] };
    expect(checkScan(result, "EUR")).toBe("mismatch");
  });
});

describe("readBill", () => {
  it("leaves an ordinary bill alone", () => {
    const bill = readBill({ ...blank, tip: "3.00", lineItems: [line("12.50")] }, "EUR");
    expect(bill.items).toHaveLength(1);
    expect(bill.extras).toEqual({ tip: "3.00", tax: null, discounts: [] });
  });

  it("moves a negative line out of the items and into the discounts, both names and all", () => {
    const credit = { label: "Remise", labelEn: "Discount", amount: "-5.00", unitAmount: null, quantity: null };
    const bill = readBill({ ...blank, lineItems: [line("30.00"), credit] }, "EUR");
    expect(bill.items.map((i) => i.amount)).toEqual(["30.00"]);
    // Both, because which one is read is the reader's choice and not the
    // scan's (`billLabel`, apps/web/lib/scan/items.ts).
    expect(bill.extras.discounts).toEqual([{ label: "Remise", labelEn: "Discount", amount: "5.00" }]);
  });

  it("gathers every deduction, wherever it arrived, and keeps them apart", () => {
    const bill = readBill({
      ...blank, tip: "-1.00", tax: "-2.00", discounts: [off("5.00", "Loyalty")],
      lineItems: [line("30.00"), line("-4.00")],
    }, "EUR");
    expect(bill.extras.tip).toBeNull();
    expect(bill.extras.tax).toBeNull();
    expect(bill.extras.discounts.map((d) => d.amount)).toEqual(["1.00", "2.00", "4.00", "5.00"]);
    expect(bill.extras.discounts.at(-1)!.label).toBe("Loyalty");
  });

  // A magnitude is what the prompt asks for, but a model that echoes the
  // printed minus sign must not turn a deduction into a surcharge.
  it("reads a discount as a magnitude whichever way the sign arrives", () => {
    for (const amount of ["8.00", "-8.00"]) {
      expect(readBill({ ...blank, discounts: [off(amount)] }, "EUR").extras.discounts)
        .toEqual([{ label: "", labelEn: null, amount: "8.00" }]);
    }
  });

  it("counts in the currency's own exponent", () => {
    expect(readBill({ ...blank, discounts: [off("-500")] }, "JPY").extras.discounts[0]!.amount)
      .toBe("500");
  });

  it("drops a deduction worth nothing rather than drawing a row for it", () => {
    expect(readBill({ ...blank, discounts: [off("0.00")], lineItems: [line("1.00")] }, "EUR")
      .extras.discounts).toEqual([]);
  });
});

describe("receiptExtras", () => {
  it("reads the three flat fields an entry keeps", () => {
    const off = [{ label: "Loyalty", amount: "5.00" }];
    expect(receiptExtras({ receiptTip: "3.00", receiptDiscounts: off }))
      .toEqual({ tip: "3.00", tax: null, discounts: off });
  });

  it("is all-null on an expense that was never scanned", () => {
    expect(receiptExtras({})).toEqual({ tip: null, tax: null, discounts: [] });
  });
});

/**
 * A line states its cost one of two ways, and this is the only multiplication
 * in the whole reading. It is here rather than in the prompt because a bill
 * priced per unit is most of what people type — "3 chicken at 13 each" — and a
 * model asked to work the 39 out itself is a model that has been given
 * permission to produce a figure the bill does not contain.
 */
describe("lineMinor", () => {
  it("takes the line total where the bill gives one", () => {
    expect(lineMinor(line("18.00"), "EUR")).toBe(1800);
  });

  it("multiplies a per-unit price by the count where that is what the bill gives", () => {
    expect(lineMinor(each("13", 3), "EUR")).toBe(3900);
    expect(lineMinor(each("15", 10), "EUR")).toBe(15000);
    expect(lineMinor(each("17", 2), "EUR")).toBe(3400);
  });

  it("multiplies in minor units, so a fractional price can't drift", () => {
    expect(lineMinor(each("0.01", 3), "EUR")).toBe(3);
    expect(lineMinor(each("1.15", 3), "EUR")).toBe(345);
    // The float that would have been: 1.15 * 3 is 3.4499999999999997.
    expect(lineMinor(each("1.15", 3), "EUR")).not.toBe(Math.round(1.15 * 3 * 100) - 1);
  });

  it("counts in the currency's own exponent", () => {
    expect(lineMinor(each("500", 3), "JPY")).toBe(1500);
    expect(lineMinor(each("5.500", 3), "TND")).toBe(16500);
  });

  it("keeps the line total when a bill somehow gives both", () => {
    expect(lineMinor({ ...each("13", 3), amount: "40.00" }, "EUR")).toBe(4000);
  });

  it("reads a per-unit deduction as the negative it is", () => {
    expect(lineMinor(each("-2.00", 3), "EUR")).toBe(-600);
  });

  // Half a figure prices nothing, and taking the per-unit price for the line
  // would charge three skewers as one.
  it.each([
    ["a price with no count", { ...each("13", 3), quantity: null }],
    ["a count with no price", { ...line("x"), quantity: 3, amount: null }],
    ["a count of none", each("13", 0)],
    ["a negative count", each("13", -2)],
    ["a fractional count", each("13", 1.5)],
    ["neither figure", { ...line("x"), amount: null }],
    ["an unparseable price", each("13,00 EUR", 2)],
  ])("refuses %s", (_what, item) => {
    expect(lineMinor(item as ScanLineItem, "EUR")).toBeNull();
  });

  it("refuses a product too large to be money", () => {
    expect(lineMinor(each("99999999999999", 999999), "EUR")).toBeNull();
  });
});

describe("readBill, on a bill priced per unit", () => {
  it("hands on the line already multiplied out", () => {
    const bill = readBill({ ...blank, lineItems: [each("13", 3)] }, "EUR");
    expect(bill.items).toEqual([{ label: "x", labelEn: null, amount: "39.00", quantity: 3 }]);
  });

  it("pools a per-unit deduction with the rest of them", () => {
    const bill = readBill({ ...blank, lineItems: [line("30.00"), each("-2.50", 2)] }, "EUR");
    expect(bill.items).toHaveLength(1);
    expect(bill.extras.discounts).toEqual([{ label: "x", labelEn: null, amount: "5.00" }]);
  });

  // `checkScan` is what refuses a line like this, and it can only do that if
  // what arrives here stays unreadable rather than being quietly priced at the
  // per-unit figure.
  it("leaves a line it cannot price unpriced, rather than guessing at it", () => {
    const bill = readBill({ ...blank, lineItems: [{ ...each("13", 3), quantity: null }] }, "EUR");
    expect(bill.items[0]!.amount).toBe("");
    expect(checkScan({ ...blank, total: "39.00", lineItems: [{ ...each("13", 3), quantity: null }] }, "EUR"))
      .toBe("unreadable-line");
  });
});

/**
 * The bill nobody added up. A photographed receipt always prints a total, so a
 * missing one there is a cropped photograph and still a refusal; a typed one
 * usually has none, and refusing those refused almost every bill anybody types.
 */
describe("checkScan, on a bill that states no total", () => {
  const typed = { ...blank, lineItems: [each("13", 3), each("15", 10), each("17", 2), line("10")] };

  it("reads a typed bill by its own lines", () => {
    expect(checkScan(typed, "EUR", "text")).toBeNull();
  });

  it("still refuses a photograph with no total — that one is cropped", () => {
    expect(checkScan(typed, "EUR", "photo")).toBe("no-total");
    expect(checkScan(typed, "EUR")).toBe("no-total");
  });

  it("refuses a typed bill with neither a total nor a line", () => {
    expect(checkScan({ ...blank, tip: "10.00" }, "EUR", "text")).toBe("no-total");
  });

  it("refuses a typed bill whose lines come to nothing", () => {
    expect(checkScan({ ...blank, lineItems: [line("0.00")] }, "EUR", "text")).toBe("mismatch");
  });

  it("refuses a typed bill a discount swallows whole", () => {
    const result = { ...blank, lineItems: [line("10.00")], discounts: [off("12.00")] };
    expect(checkScan(result, "EUR", "text")).toBe("mismatch");
  });

  it("still refuses a line it can't read", () => {
    const result = { ...blank, lineItems: [line("10.00"), line("17,50 EUR")] };
    expect(checkScan(result, "EUR", "text")).toBe("unreadable-line");
  });

  it("still refuses a tip it can't read", () => {
    expect(checkScan({ ...blank, lineItems: [line("10.00")], tip: "n/a" }, "EUR", "text"))
      .toBe("unreadable-line");
  });

  // The whole reason the derived total is not then checked against the lines:
  // it came from them, so it agrees with them by construction. What is still
  // worth refusing is a total the bill did state and does not match.
  it("reconciles against a total the bill did state, in either medium", () => {
    const stated = { ...typed, total: "233.00" };
    expect(checkScan(stated, "EUR", "text")).toBeNull();
    expect(checkScan({ ...stated, total: "999.00" }, "EUR", "text")).toBe("mismatch");
  });

  it("refuses a stated total it cannot read, in either medium", () => {
    expect(checkScan({ ...typed, total: "abc" }, "EUR", "text")).toBe("no-total");
  });
});

describe("billTotalMinor", () => {
  it("prefers the total the bill states", () => {
    expect(billTotalMinor({ ...blank, total: "42.50", lineItems: [line("1.00")] }, "EUR")).toBe(4250);
  });

  it("adds the bill up where it states none", () => {
    const typed = { ...blank, lineItems: [each("13", 3), each("15", 10), each("17", 2), line("10")] };
    expect(billTotalMinor(typed, "EUR")).toBe(23300);
    expect(billTotalMinor({ ...typed, tip: "10.00" }, "EUR")).toBe(24300);
    expect(billTotalMinor({ ...typed, discounts: [off("3.00")] }, "EUR")).toBe(23000);
  });

  it("is null when there is nothing to add up and nothing stated", () => {
    expect(billTotalMinor(blank, "EUR")).toBeNull();
    expect(billTotalMinor({ ...blank, lineItems: [line("abc")] }, "EUR")).toBeNull();
  });
});

describe("normalizeScan, on a bill that states no total", () => {
  // The Polish skewers that started this: 3 at 13, 10 at 15, 2 at 17, a cola
  // at 10 and a tip of 10, with no total written anywhere.
  const typed: ScanResult = {
    ...blank,
    lineItems: [each("13", 3), each("15", 10), each("17", 2), line("10")],
    tip: "10",
  };

  it("fills the amount from the bill's own lines", () => {
    expect(normalizeScan(typed, "EUR", NOW)).toMatchObject({ amountText: "243.00" });
  });

  it("writes it in the currency the reading is counted in", () => {
    expect(normalizeScan(typed, "JPY", NOW)).toMatchObject({ amountText: "243" });
  });

  it("leaves the amount alone where there is nothing to add up", () => {
    expect(normalizeScan(blank, "EUR", NOW)).not.toHaveProperty("amountText");
  });

  // Almost never a title, and this bill names no merchant at all.
  it("takes no description from a bill with no name in it", () => {
    expect(normalizeScan(typed, "EUR", NOW)).not.toHaveProperty("description");
  });
});
