import { describe, expect, it } from "vitest";
import {
  convertMinor, exponentOf, formatMinor, minorToDecimalString,
  parseMinor, isValidRate, sumMinor,
} from "./money.js";

describe("exponentOf", () => {
  it("defaults to 2 but knows the exceptions", () => {
    expect(exponentOf("EUR")).toBe(2);
    expect(exponentOf("MAD")).toBe(2);
    expect(exponentOf("JPY")).toBe(0);
    expect(exponentOf("jpy")).toBe(0);
    expect(exponentOf("TND")).toBe(3);
    expect(exponentOf("CLF")).toBe(4);
  });
});

describe("parseMinor", () => {
  it("parses the shapes a human types", () => {
    expect(parseMinor("57.10", "EUR")).toBe(5710);
    expect(parseMinor("57,10", "EUR")).toBe(5710);
    expect(parseMinor(" 1 234,56 ", "EUR")).toBe(123456);
    expect(parseMinor("620", "MAD")).toBe(62000);
    expect(parseMinor("-5", "EUR")).toBe(-500);
    expect(parseMinor(".5", "EUR")).toBe(50);
    expect(parseMinor("0", "EUR")).toBe(0);
  });

  it("respects the currency's exponent", () => {
    expect(parseMinor("1200", "JPY")).toBe(1200);
    expect(parseMinor("1.234", "TND")).toBe(1234);
  });

  it("rounds excess precision rather than truncating it", () => {
    expect(parseMinor("1.005", "EUR")).toBe(101);
    expect(parseMinor("1.004", "EUR")).toBe(100);
  });

  it("rejects nonsense", () => {
    for (const bad of ["", "-", "abc", "1.2.3", "1e5", "€5"]) {
      expect(() => parseMinor(bad, "EUR")).toThrow();
    }
  });
});

describe("minorToDecimalString", () => {
  it("round-trips", () => {
    expect(minorToDecimalString(5710, "EUR")).toBe("57.10");
    expect(minorToDecimalString(-10563, "EUR")).toBe("-105.63");
    expect(minorToDecimalString(1200, "JPY")).toBe("1200");
    expect(minorToDecimalString(1234, "TND")).toBe("1.234");
    expect(minorToDecimalString(5, "EUR")).toBe("0.05");
    expect(minorToDecimalString(0, "EUR")).toBe("0.00");
  });
});

describe("formatMinor", () => {
  it("formats for humans without inventing precision", () => {
    expect(formatMinor(5710, "EUR", { locale: "en-IE" })).toContain("57.10");
    expect(formatMinor(-10563, "EUR", { locale: "en-IE" })).toContain("105.63");
    expect(formatMinor(1200, "JPY", { locale: "en-US" })).toContain("1,200");
  });

  it("can force a sign, which balances need", () => {
    expect(formatMinor(4116, "EUR", { locale: "en-IE", signDisplay: "always" })).toContain("+");
    expect(formatMinor(0, "EUR", { locale: "en-IE", signDisplay: "always" })).not.toContain("+");
  });
});

describe("convertMinor", () => {
  it("converts at a locked rate, rounding once", () => {
    // Every figure in the Marrakech mockup, at 1 MAD = 0.0921 EUR.
    expect(convertMinor(62000, "MAD", "EUR", "0.0921")).toBe(5710);
    expect(convertMinor(30000, "MAD", "EUR", "0.0921")).toBe(2763);
    expect(convertMinor(48000, "MAD", "EUR", "0.0921")).toBe(4421);
    expect(convertMinor(185000, "MAD", "EUR", "0.0921")).toBe(17039);
    expect(convertMinor(70000, "MAD", "EUR", "0.0921")).toBe(6447);
    expect(convertMinor(21000, "MAD", "EUR", "0.0921")).toBe(1934);
  });

  it("is exact at rate 1", () => {
    expect(convertMinor(58000, "EUR", "EUR", "1")).toBe(58000);
  });

  it("crosses differing exponents", () => {
    // 1000 JPY at 0.0062 EUR/JPY = 6.20 EUR
    expect(convertMinor(1000, "JPY", "EUR", "0.0062")).toBe(620);
    // 10.00 EUR at 163 JPY/EUR = 1630 JPY
    expect(convertMinor(1000, "EUR", "JPY", "163")).toBe(1630);
  });

  it("rounds half away from zero", () => {
    expect(convertMinor(100, "EUR", "EUR", "1.005")).toBe(101);
    expect(convertMinor(-100, "EUR", "EUR", "1.005")).toBe(-101);
  });

  it("rejects a rate that isn't one", () => {
    for (const bad of ["0", "-1", "abc", "", "1,5"]) {
      expect(isValidRate(bad)).toBe(false);
      expect(() => convertMinor(100, "MAD", "EUR", bad)).toThrow();
    }
  });
});

describe("sumMinor", () => {
  it("adds", () => {
    expect(sumMinor([5710, 2763, 4421])).toBe(12894);
    expect(sumMinor([])).toBe(0);
  });
});
