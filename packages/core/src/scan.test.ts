import { describe, expect, it } from "vitest";
import { normalizeScan } from "./scan.js";

describe("normalizeScan", () => {
  it("cleans a plain decimal total", () => {
    expect(normalizeScan({ merchant: null, total: "42.50", currency: null, date: null, category: null }))
      .toMatchObject({ amountText: "42.50" });
  });

  it("cleans a comma-decimal total", () => {
    expect(normalizeScan({ merchant: null, total: "42,50", currency: null, date: null, category: null }))
      .toMatchObject({ amountText: "42.50" });
  });

  it("cleans a thousands-dot, comma-decimal total", () => {
    expect(normalizeScan({ merchant: null, total: "1.234,50", currency: null, date: null, category: null }))
      .toMatchObject({ amountText: "1234.50" });
  });

  it("treats a lone thousands separator as grouping, not cents", () => {
    expect(normalizeScan({ merchant: null, total: "1,234", currency: null, date: null, category: null }))
      .toMatchObject({ amountText: "1234" });
    expect(normalizeScan({ merchant: null, total: "1.234", currency: null, date: null, category: null }))
      .toMatchObject({ amountText: "1234" });
  });

  it("strips a currency symbol", () => {
    expect(normalizeScan({ merchant: null, total: "€42.50", currency: null, date: null, category: null }))
      .toMatchObject({ amountText: "42.50" });
  });

  it("passes a plain integer through untouched", () => {
    expect(normalizeScan({ merchant: null, total: "620", currency: null, date: null, category: null }))
      .toMatchObject({ amountText: "620" });
  });

  it("keeps a leading minus", () => {
    expect(normalizeScan({ merchant: null, total: "-5.00", currency: null, date: null, category: null }))
      .toMatchObject({ amountText: "-5.00" });
  });

  it("uppercases the currency", () => {
    expect(normalizeScan({ merchant: null, total: null, currency: "eur", date: null, category: null }))
      .toMatchObject({ currency: "EUR" });
  });

  it("converts a printed date to an instant", () => {
    const { occurredAt } = normalizeScan({ merchant: null, total: null, currency: null, date: "2026-08-28", category: null });
    expect(occurredAt).toBe(Date.parse("2026-08-28T00:00:00Z"));
  });

  it("passes merchant and category through as the description and category patch", () => {
    expect(normalizeScan({ merchant: "Carrefour", total: null, currency: null, date: null, category: "Groceries" }))
      .toMatchObject({ description: "Carrefour", category: "Groceries" });
  });

  it("omits fields the model couldn't read", () => {
    expect(normalizeScan({ merchant: null, total: null, currency: null, date: null, category: null }))
      .toEqual({});
  });
});
