import { describe, expect, it } from "vitest";
import {
  checkScan, normalizeScan, readBill, receiptExtras, scanCurrency,
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
    expect(normalizeScan({ ...blank, total: "42.50" }, NOW)).toMatchObject({ amountText: "42.50" });
  });

  it("passes a plain integer through untouched", () => {
    expect(normalizeScan({ ...blank, total: "620" }, NOW)).toMatchObject({ amountText: "620" });
  });

  it("keeps a leading minus", () => {
    expect(normalizeScan({ ...blank, total: "-5.00" }, NOW)).toMatchObject({ amountText: "-5.00" });
  });

  it("uppercases the currency", () => {
    expect(normalizeScan({ ...blank, currency: "eur" }, NOW)).toMatchObject({ currency: "EUR" });
  });

  // Anything formatMinor would throw on has to be dropped, not repaired:
  // the form formats the draft's currency on every render.
  it.each(["\u20ac", "EU", "USDT", "12", "", "  "])(
    "drops a currency that isn't three letters: %j",
    (currency) => {
      expect(normalizeScan({ ...blank, currency }, NOW)).not.toHaveProperty("currency");
    },
  );

  it("converts a printed date to local midnight, not UTC midnight", () => {
    const { occurredAt } = normalizeScan({ ...blank, date: "2026-08-28" }, NOW);
    expect(occurredAt).toBe(new Date(2026, 7, 28).getTime());
  });

  // The whole point: whatever the offset, the day you read back is the day
  // that was printed on the receipt.
  it("reads the date back as the day that was printed", () => {
    const { occurredAt } = normalizeScan({ ...blank, date: "2026-04-04" }, NOW);
    const back = new Date(occurredAt!);
    expect([back.getFullYear(), back.getMonth() + 1, back.getDate()]).toEqual([2026, 4, 4]);
  });

  // Midnight is this app's "day known, time not", so a receipt scanned on the
  // day it was printed must not claim it: the scan is the time.
  it("stamps a receipt printed today with the moment of the scan", () => {
    const today = new Date(NOW);
    const printed = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(normalizeScan({ ...blank, date: printed }, NOW)).toMatchObject({ occurredAt: NOW });
  });

  it("leaves a backdated receipt at midnight, time unknown", () => {
    const { occurredAt } = normalizeScan({ ...blank, date: "2026-08-28" }, NOW);
    const back = new Date(occurredAt!);
    expect([back.getHours(), back.getMinutes(), back.getSeconds(), back.getMilliseconds()])
      .toEqual([0, 0, 0, 0]);
  });

  it("omits an unparseable date", () => {
    expect(normalizeScan({ ...blank, date: "last Tuesday" }, NOW)).not.toHaveProperty("occurredAt");
  });

  // The title is the model's, adaptations and all — the prompt asks it to
  // strip what isn't the name and to say what was bought where the name alone
  // wouldn't. Nothing here second-guesses that; it lands as typed.
  it("passes the title through as the description", () => {
    expect(normalizeScan({ ...blank, title: "Lidl - barbecue" }, NOW))
      .toMatchObject({ description: "Lidl - barbecue" });
  });

  it("omits fields the model couldn't read, tip and line items included", () => {
    expect(normalizeScan(blank, NOW)).toEqual({});
  });

  it("doesn't fold tip or line items into the draft patch — the seam is unused today", () => {
    const result: ScanResult = {
      ...blank,
      total: "50.00",
      tip: "5.00",
      lineItems: [{ label: "Café", labelEn: "Coffee", amount: "3.50", quantity: null }],
    };
    expect(normalizeScan(result, NOW)).toEqual({ amountText: "50.00" });
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
const line = (amount: string): ScanLineItem => ({ label: "x", labelEn: null, amount, quantity: null });

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

  it("moves a negative line out of the items and into the discounts, name and all", () => {
    const credit = { label: "Remise", labelEn: "Discount", amount: "-5.00", quantity: null };
    const bill = readBill({ ...blank, lineItems: [line("30.00"), credit] }, "EUR");
    expect(bill.items.map((i) => i.amount)).toEqual(["30.00"]);
    expect(bill.extras.discounts).toEqual([{ label: "Discount", amount: "5.00" }]);
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
        .toEqual([{ label: "", amount: "8.00" }]);
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
