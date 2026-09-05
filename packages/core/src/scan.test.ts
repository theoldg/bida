import { describe, expect, it } from "vitest";
import { checkScan, normalizeScan, scanCurrency, type ScanLineItem, type ScanResult } from "./scan.js";

const blank: ScanResult = {
  merchant: null, total: null, tip: null, currency: null, date: null, lineItems: [], error: null,
};

describe("normalizeScan", () => {
  it("passes the model's normalized total through untouched", () => {
    expect(normalizeScan({ ...blank, total: "42.50" })).toMatchObject({ amountText: "42.50" });
  });

  it("passes a plain integer through untouched", () => {
    expect(normalizeScan({ ...blank, total: "620" })).toMatchObject({ amountText: "620" });
  });

  it("keeps a leading minus", () => {
    expect(normalizeScan({ ...blank, total: "-5.00" })).toMatchObject({ amountText: "-5.00" });
  });

  it("uppercases the currency", () => {
    expect(normalizeScan({ ...blank, currency: "eur" })).toMatchObject({ currency: "EUR" });
  });

  // Anything formatMinor would throw on has to be dropped, not repaired:
  // the form formats the draft's currency on every render.
  it.each(["\u20ac", "EU", "USDT", "12", "", "  "])(
    "drops a currency that isn't three letters: %j",
    (currency) => {
      expect(normalizeScan({ ...blank, currency })).not.toHaveProperty("currency");
    },
  );

  it("converts a printed date to local midnight, not UTC midnight", () => {
    const { occurredAt } = normalizeScan({ ...blank, date: "2026-08-28" });
    expect(occurredAt).toBe(new Date(2026, 7, 28).getTime());
  });

  // The whole point: whatever the offset, the day you read back is the day
  // that was printed on the receipt.
  it("reads the date back as the day that was printed", () => {
    const { occurredAt } = normalizeScan({ ...blank, date: "2026-04-04" });
    const back = new Date(occurredAt!);
    expect([back.getFullYear(), back.getMonth() + 1, back.getDate()]).toEqual([2026, 4, 4]);
  });

  it("omits an unparseable date", () => {
    expect(normalizeScan({ ...blank, date: "last Tuesday" })).not.toHaveProperty("occurredAt");
  });

  it("passes the merchant through as the description", () => {
    expect(normalizeScan({ ...blank, merchant: "Carrefour" }))
      .toMatchObject({ description: "Carrefour" });
  });

  it("omits fields the model couldn't read, tip and line items included", () => {
    expect(normalizeScan(blank)).toEqual({});
  });

  it("doesn't fold tip or line items into the draft patch — the seam is unused today", () => {
    const result: ScanResult = {
      ...blank,
      total: "50.00",
      tip: "5.00",
      lineItems: [{ label: "Café", labelEn: "Coffee", amount: "3.50", quantity: null }],
    };
    expect(normalizeScan(result)).toEqual({ amountText: "50.00" });
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

  it("refuses a credit line, even one the total accounts for", () => {
    const result = { ...blank, total: "25.00", lineItems: [line("30.00"), line("-5.00")] };
    expect(checkScan(result, "EUR")).toBe("credit-line");
  });

  it("refuses a negative tip", () => {
    expect(checkScan({ ...blank, total: "30.00", tip: "-1.00" }, "EUR")).toBe("credit-line");
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
