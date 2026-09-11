import { describe, expect, it } from "vitest";
import { clipAmountToCurrency, groupDigits, sanitizeAmount } from "./amount-input";

/**
 * The caret and the grouping are the whole point of this component, and both
 * are pure string arithmetic — so they get real tests rather than the smoke
 * test the rest of the UI gets.
 */
describe("sanitizeAmount", () => {
  it("keeps digits, one separator, and the currency's fraction length", () => {
    expect(sanitizeAmount("48ex00", "EUR")).toBe("4800");
    expect(sanitizeAmount("12.3.4", "EUR")).toBe("12.34");
    expect(sanitizeAmount("12.345", "EUR")).toBe("12.34");
    expect(sanitizeAmount("12.345", "JPY")).toBe("12");
    expect(sanitizeAmount("12.345", "BHD")).toBe("12.345");
  });

  it("takes a comma as a decimal separator, because half of Europe types one", () => {
    expect(sanitizeAmount("12,50", "EUR")).toBe("12.50");
  });

  it("keeps a half-typed amount half-typed", () => {
    // The old field parsed on every keystroke and threw this away, so "1.50"
    // could never be typed at all.
    expect(sanitizeAmount("1.", "EUR")).toBe("1.");
    expect(sanitizeAmount("", "EUR")).toBe("");
  });

  it("strips leading zeros but keeps a lone one", () => {
    expect(sanitizeAmount("007", "EUR")).toBe("7");
    expect(sanitizeAmount("0", "EUR")).toBe("0");
    expect(sanitizeAmount("0.5", "EUR")).toBe("0.5");
  });
});

describe("groupDigits", () => {
  it("groups the whole part and leaves the fraction alone", () => {
    expect(groupDigits("4800")).toBe("4 800");
    expect(groupDigits("1234567.89")).toBe("1 234 567.89");
    expect(groupDigits("999")).toBe("999");
    expect(groupDigits("12.")).toBe("12.");
    expect(groupDigits("")).toBe("");
  });
});

describe("a separator typed with nothing before it", () => {
  it("reads as nought point something", () => {
    expect(sanitizeAmount(",5", "EUR")).toBe("0.5");
    expect(sanitizeAmount(".", "EUR")).toBe("0.");
  });
});

/**
 * A currency change is not a keystroke, so nothing else clips the field for
 * one. Both writers of an entry draft go through this — the form on every
 * patch, and a scan, which brings the receipt's own currency with it.
 */
describe("clipAmountToCurrency", () => {
  it("clips the fraction the new currency has no room for", () => {
    expect(clipAmountToCurrency({ amountText: "12.34", currency: "JPY" }).amountText).toBe("12");
    expect(clipAmountToCurrency({ amountText: "12.345", currency: "EUR" }).amountText).toBe("12.34");
    expect(clipAmountToCurrency({ amountText: "12.345", currency: "BHD" }).amountText).toBe("12.345");
  });

  it("returns the very same object when nothing needs clipping", () => {
    const draft = { amountText: "12.34", currency: "EUR", extra: 1 };
    expect(clipAmountToCurrency(draft)).toBe(draft);
  });

  it("keeps every other field of whatever it was handed", () => {
    expect(clipAmountToCurrency({ amountText: "9.99", currency: "JPY", description: "Sushi" }))
      .toEqual({ amountText: "9", currency: "JPY", description: "Sushi" });
  });
});
