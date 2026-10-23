import { describe, expect, it } from "vitest";
import {
  COMMON_CURRENCIES, currencyChoices, currencyLabel, currencySearch, normalizeCurrencyCode,
} from "./currencies";

describe("normalizeCurrencyCode", () => {
  it("uppercases, drops everything else and stops at three", () => {
    expect(normalizeCurrencyCode(" u z s 1")).toBe("UZS");
    expect(normalizeCurrencyCode("eurusd")).toBe("EUR");
  });
});

describe("currencyLabel", () => {
  it("names every currency the picker offers", () => {
    for (const code of COMMON_CURRENCIES) {
      expect(currencyLabel(code), code).toMatch(new RegExp(`^${code} · .`));
    }
  });

  it("names the two Intl can be short of, whatever the locale data holds", () => {
    expect(currencyLabel("ISK")).toBe("ISK · Icelandic Króna");
    expect(currencyLabel("UZS")).toBe("UZS · Uzbekistani Som");
  });

  it("leaves a code nobody has a name for as a code", () => {
    expect(currencyLabel("QQQ")).toBe("QQQ");
  });
});

describe("currencyChoices", () => {
  it("puts the group's currencies right below the pinned ones", () => {
    const choices = currencyChoices(["PLN"], ["MAD", "USD"]);
    expect(choices.slice(0, 3)).toEqual(["PLN", "MAD", "USD"]);
  });

  it("keeps each currency once, at its first place", () => {
    const choices = currencyChoices(["EUR", "EUR"], ["USD", "EUR"]);
    expect(choices.filter((c) => c === "EUR")).toEqual(["EUR"]);
    expect(choices.indexOf("USD")).toBe(1);
    expect(choices.indexOf("GBP")).toBeGreaterThan(1);
  });

  it("still offers the common list after them", () => {
    for (const code of COMMON_CURRENCIES) {
      expect(currencyChoices(["EUR"], ["MAD"])).toContain(code);
    }
  });
});

describe("currencySearch", () => {
  const choices = currencyChoices(["PLN"], ["MAD"]);
  const known = ["BRL", "EUR", "KRW", "MAD", "PLN", "USD", "ZAR"];

  it("is the list as it stands until something is typed", () => {
    expect(currencySearch("  ", choices, known)).toEqual({ codes: choices, typed: null });
  });

  it("puts the code typed first, then codes starting so, then names", () => {
    // "Israeli New Shekel" holds "is" too, and is listed first, but only by name.
    expect(currencySearch("is", ["ILS", "ISK"], []).codes).toEqual(["ISK", "ILS"]);
    expect(currencySearch("usd", choices, known).codes[0]).toBe("USD");
  });

  it("reaches past the list to every currency the browser knows", () => {
    expect(currencySearch("brl", choices, known).codes).toEqual(["BRL"]);
  });

  it("finds a name without its accents", () => {
    expect(currencySearch("krona", choices, known).codes).toContain("ISK");
  });

  it("offers three letters no code answers as typed, and nothing else", () => {
    expect(currencySearch("qqq", choices, known)).toEqual({ codes: [], typed: "QQQ" });
    expect(currencySearch("eur", choices, known).typed).toBeNull();
    expect(currencySearch("q q", choices, known).typed).toBeNull();
  });
});
