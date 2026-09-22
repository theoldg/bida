import { describe, expect, it } from "vitest";
import { clipAmountToCurrency, sanitizeAmount, settleAmount } from "./amount-input";

/**
 * What may be typed is pure string arithmetic, so it gets real tests rather
 * than the smoke test the rest of the UI gets. The grouping it displays is
 * `groupDigits`, tested next to the rest of the formatting in `lib/format`.
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
    // Parsing this away on a keystroke would make "1.50" untypeable.
    expect(sanitizeAmount("1.", "EUR")).toBe("1.");
    expect(sanitizeAmount("", "EUR")).toBe("");
  });

  it("strips leading zeros but keeps a lone one", () => {
    expect(sanitizeAmount("007", "EUR")).toBe("7");
    expect(sanitizeAmount("0", "EUR")).toBe("0");
    expect(sanitizeAmount("0.5", "EUR")).toBe("0.5");
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

/**
 * What the field does when you leave it — the other half of holding the text
 * you typed rather than a round-trip of it.
 */
describe("settleAmount", () => {
  it("pads a finished amount to the currency's fraction", () => {
    expect(settleAmount("5", "EUR")).toBe("5.00");
    expect(settleAmount("1.5", "EUR")).toBe("1.50");
    expect(settleAmount("5", "BHD")).toBe("5.000");
  });

  it("finishes a separator left hanging", () => {
    expect(settleAmount("1.", "EUR")).toBe("1.00");
    expect(settleAmount("0.", "EUR")).toBe("0.00");
  });

  it("leaves an empty field empty, so its placeholder survives", () => {
    expect(settleAmount("", "EUR")).toBe("");
  });

  it("has nothing to pad in a currency with no minor units", () => {
    expect(settleAmount("5", "JPY")).toBe("5");
  });

  it("settles what the field can hold, whatever half of it was typed", () => {
    // `sanitizeAmount` never produces a bare separator, but the settling has
    // to be total: every text the field can be left holding settles to a
    // figure or to nothing, never to something a parse would drop.
    expect(settleAmount(".", "EUR")).toBe("0.00");
    expect(settleAmount("0", "EUR")).toBe("0.00");
  });
});
