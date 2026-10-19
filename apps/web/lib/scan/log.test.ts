import { describe, expect, it } from "vitest";
import { describeReading } from "./log";

describe("a kept reading", () => {
  it("prints every figure the model returned, discounts apart from lines", () => {
    const lines = describeReading({
      at: Date.UTC(2026, 9, 19, 14, 20, 1),
      outcome: "mismatch",
      read: {
        title: "Rossmann", total: "205.92", tip: null, tax: null, currency: "PLN",
        date: "2026-10-19", english: false, error: null,
        lineItems: [
          { label: "Domol płyn d/pran", labelEn: null, amount: "27.98", unitAmount: "13.99", quantity: 2 },
          { label: "Got2b phenomenal", labelEn: null, amount: "23.99", unitAmount: null, quantity: null },
        ],
        discounts: [{ label: "Uwzgl. opust", labelEn: null, amount: "15.00" }],
      },
    });
    expect(lines).toEqual([
      "10-19 14:20:01  MISMATCH  total 205.92 PLN  2026-10-19  Rossmann",
      "      27.98  2 × 13.99  Domol płyn d/pran",
      "      23.99  Got2b phenomenal",
      "     -15.00  off  Uwzgl. opust",
      "  tip —  tax —",
    ]);
  });

  it("prints a refusal's sentence instead of fields it left empty", () => {
    const lines = describeReading({
      at: 0,
      outcome: "rejected",
      read: {
        title: null, total: null, tip: null, tax: null, currency: null, date: null,
        english: false, error: "Too blurry.", lineItems: [], discounts: [],
      },
    });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("  error  Too blurry.");
  });
});
