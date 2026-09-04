import { describe, expect, it } from "vitest";
import {
  convertMinor, exponentOf, formatMinor, isCurrencyCode, minorToDecimalString,
  parseMinor, isValidRate, sanitizeRate, sumMinor,
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

describe("isCurrencyCode", () => {
  // It exists to answer exactly one question: will formatMinor survive this?
  it.each(["EUR", "JPY", "ZZZ"])("accepts %s, which formatMinor formats", (code) => {
    expect(isCurrencyCode(code)).toBe(true);
    expect(() => formatMinor(1000, code)).not.toThrow();
  });

  it.each(["\u20ac", "EU", "USDT", "US1", "", " EUR"])(
    "rejects %j, which formatMinor throws on",
    (code) => {
      expect(isCurrencyCode(code)).toBe(false);
      expect(() => formatMinor(1000, code)).toThrow();
    },
  );

  // Intl is happy with "eur"; the rest of the app is not, since a code is
  // compared against the group's base by string equality. Callers uppercase
  // before asking, so this stays a check on the canonical form.
  it("rejects a lowercase code even though Intl would take it", () => {
    expect(isCurrencyCode("eur")).toBe(false);
    expect(() => formatMinor(1000, "eur")).not.toThrow();
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
    // Every figure in the Marrakech fixture, at 1 MAD = 0.0921 EUR.
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

describe("sanitizeRate", () => {
  // The typed text has to come out as something isValidRate accepts, or the
  // field goes red at somebody whose keyboard is simply not American.
  it.each([
    ["4,32", "4.32"],
    ["4.32", "4.32"],
    ["1,0921", "1.0921"],
    ["10", "10"],
    ["", ""],
  ])("normalises %s to %s", (raw, want) => {
    expect(sanitizeRate(raw)).toBe(want);
  });

  it("keeps the first separator and drops the rest", () => {
    expect(sanitizeRate("1,2,3")).toBe("1.23");
    expect(sanitizeRate("1.2.3")).toBe("1.23");
  });

  it("throws nothing away that a rate needs", () => {
    expect(sanitizeRate("0,000001")).toBe("0.000001");
    expect(isValidRate(sanitizeRate("0,0921"))).toBe(true);
  });

  it("drops what a rate can't hold", () => {
    expect(sanitizeRate("-4,32")).toBe("4.32");
    expect(sanitizeRate("4 32 EUR")).toBe("432");
  });
});

describe("sumMinor", () => {
  it("adds", () => {
    expect(sumMinor([5710, 2763, 4421])).toBe(12894);
    expect(sumMinor([])).toBe(0);
  });
});
