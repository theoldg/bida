import { describe, expect, it } from "vitest";
import {
  convertMinor, exponentOf, formatMinor, isCurrencyCode, minorToDecimalString,
  parseMinor, isValidRate, sanitizeRate, sumMinor,
  formatRate, invertRate, rateFromNumber, RATE_DIGITS, RATE_SHOWN_DIGITS,
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

  // Codes are compared by string equality with the group's base; callers uppercase first.
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
  // Must come out as something isValidRate accepts, whatever the keyboard.
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

describe("rateFromNumber", () => {
  it.each([
    [0.234043, "0.234043"],
    [4.5, "4.5"],
    [1, "1"],
    [10.834, "10.834"],
    [0.0921, "0.0921"],
  ])("keeps %s as it was printed", (value, want) => {
    expect(rateFromNumber(value)).toBe(want);
  });

  // String(5e-7) is "5e-7", which isValidRate rejects — a Save that never lights.
  it.each([5e-7, 1.0834e-5, 2.5e-8, 1e-21])("writes %s out in full", (value) => {
    const rate = rateFromNumber(value);
    expect(rate).not.toContain("e");
    expect(isValidRate(rate)).toBe(true);
  });

  it("writes a large rate out in full too", () => {
    // UZS to EUR the wrong way round: the feed publishes both directions.
    expect(rateFromNumber(1.2e21)).toBe("1200000000000000000000");
    expect(isValidRate(rateFromNumber(1e30))).toBe(true);
  });

  it("rounds to the digits asked for, and trims what that leaves", () => {
    expect(rateFromNumber(0.23404255319148936, 6)).toBe("0.234043");
    expect(rateFromNumber(4.5, 6)).toBe("4.5");
    expect(rateFromNumber(0.999999999999, 6)).toBe("1");
  });

  it("refuses what is not a rate", () => {
    expect(() => rateFromNumber(0)).toThrow(RangeError);
    expect(() => rateFromNumber(-1)).toThrow(RangeError);
    expect(() => rateFromNumber(NaN)).toThrow(RangeError);
    expect(() => rateFromNumber(Infinity)).toThrow(RangeError);
  });
});

describe("invertRate", () => {
  it.each([
    ["4", "0.25"],
    ["0.25", "4"],
    ["1", "1"],
    ["2", "0.5"],
    ["0.5", "2"],
  ])("turns %s into %s exactly", (rate, want) => {
    expect(invertRate(rate)).toBe(want);
  });

  it("takes a repeating reciprocal to the digits it was asked for", () => {
    expect(invertRate("3", 12)).toBe("0.333333333333");
    expect(invertRate("4.5", 12)).toBe("0.222222222222");
    expect(invertRate("7", 6)).toBe("0.142857");
  });

  it("rounds half away from zero rather than truncating", () => {
    // 1/1.6 = 0.625 exactly; asked for two digits that is 0.63, not 0.62.
    expect(invertRate("1.6", 2)).toBe("0.63");
    // 1/8 = 0.125 -> 0.13 at two digits.
    expect(invertRate("8", 2)).toBe("0.13");
  });

  it("carries past the front of the number", () => {
    // 1/0.10005 = 9.995... which rounds to 10 at three digits, not 9.99.
    expect(invertRate("0.10005", 3)).toBe("10");
  });

  // Typing "1 EUR = 4.5 PLN" in the second field stores 1/4.5; the field must
  // still read "4.5" afterwards, not "4.500000001".
  const asTypedBack = (typed: string) =>
    formatRate(invertRate(invertRate(typed, RATE_DIGITS), RATE_DIGITS), RATE_SHOWN_DIGITS);

  it.each(["4.5", "3.5", "1.0001", "0.0921", "12345.6", "0.000004", "1", "7"])(
    "reads %s back after storing its reciprocal", (typed) => {
      expect(asTypedBack(typed)).toBe(typed);
    },
  );

  it("survives a rate with more precision than a double holds", () => {
    expect(invertRate("0.333333333333333333333", 6)).toBe("3");
  });

  it("refuses what is not a rate", () => {
    expect(() => invertRate("0")).toThrow(RangeError);
    expect(() => invertRate("")).toThrow(RangeError);
    expect(() => invertRate("abc")).toThrow(RangeError);
  });
});

describe("formatRate", () => {
  it("shows a stored rate at reading precision", () => {
    expect(formatRate("0.222222222222")).toBe("0.222222");
    expect(formatRate("4.5")).toBe("4.5");
    expect(formatRate("1")).toBe("1");
    expect(formatRate("0.0000123456789", 4)).toBe("0.00001235");
  });

  it("leaves a rate shorter than the limit alone", () => {
    expect(formatRate("4.32")).toBe("4.32");
    expect(formatRate("10")).toBe("10");
  });

  // Display only: convertMinor reads the dropped digits, which matter on a large
  // enough amount.
  it("never changes what the arithmetic uses", () => {
    const stored = invertRate("4.5");
    expect(stored).toBe("0.222222222222");
    expect(formatRate(stored)).toBe("0.222222");
    const huge = 2_250_000_000;
    expect(convertMinor(huge, "PLN", "EUR", stored)).toBe(500_000_000);
    expect(convertMinor(huge, "PLN", "EUR", formatRate(stored))).toBe(499_999_500);
  });

  it("always produces something isValidRate accepts", () => {
    for (const rate of ["0.000000000123456789", "999999999999.999", "1", "0.5"]) {
      expect(isValidRate(formatRate(rate))).toBe(true);
    }
  });
});
