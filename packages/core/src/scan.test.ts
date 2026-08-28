import { describe, expect, it } from "vitest";
import { normalizeScan, type ScanResult } from "./scan.js";

const blank: ScanResult = {
  merchant: null, total: null, tip: null, currency: null, date: null, category: null, lineItems: [], error: null,
};

describe("normalizeScan", () => {
  it("cleans a plain decimal total", () => {
    expect(normalizeScan({ ...blank, total: "42.50" })).toMatchObject({ amountText: "42.50" });
  });

  it("cleans a comma-decimal total", () => {
    expect(normalizeScan({ ...blank, total: "42,50" })).toMatchObject({ amountText: "42.50" });
  });

  it("cleans a thousands-dot, comma-decimal total", () => {
    expect(normalizeScan({ ...blank, total: "1.234,50" })).toMatchObject({ amountText: "1234.50" });
  });

  it("treats a lone thousands separator as grouping, not cents", () => {
    expect(normalizeScan({ ...blank, total: "1,234" })).toMatchObject({ amountText: "1234" });
    expect(normalizeScan({ ...blank, total: "1.234" })).toMatchObject({ amountText: "1234" });
  });

  it("strips a currency symbol", () => {
    expect(normalizeScan({ ...blank, total: "€42.50" })).toMatchObject({ amountText: "42.50" });
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

  it("converts a printed date to an instant", () => {
    const { occurredAt } = normalizeScan({ ...blank, date: "2026-08-28" });
    expect(occurredAt).toBe(Date.parse("2026-08-28T00:00:00Z"));
  });

  it("passes merchant and category through as the description and category patch", () => {
    expect(normalizeScan({ ...blank, merchant: "Carrefour", category: "Groceries" }))
      .toMatchObject({ description: "Carrefour", category: "Groceries" });
  });

  it("omits fields the model couldn't read, tip and line items included", () => {
    expect(normalizeScan(blank)).toEqual({});
  });

  it("doesn't fold tip or line items into the draft patch — the seam is unused today", () => {
    const result: ScanResult = {
      ...blank,
      total: "50.00",
      tip: "5.00",
      lineItems: [{ label: "Café", labelEn: "Coffee", amount: "3.50" }],
    };
    expect(normalizeScan(result)).toEqual({ amountText: "50.00" });
  });
});
