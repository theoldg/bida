import { describe, expect, it } from "vitest";
import { blankDraft, type EntryDraft } from "./draft";
import { rateDayOf, rateLookupWanted, savedRateBack, settleRate } from "./entry-rate";

/**
 * When the form asks the feed for an entry's rate, and what it settles on when
 * the feed can't answer (ADR-0005). The rate is money, so these are questions,
 * not a mounted form.
 */

const DAY = new Date(2026, 9, 5, 19, 30).getTime();
const NEXT_DAY = new Date(2026, 9, 6, 12, 0).getTime();

function draft(over: Partial<EntryDraft> = {}): EntryDraft {
  return { ...blankDraft("expense", "m-theo", "EUR", ["m-theo"], DAY), ...over };
}

/** A draft holding a MAD rate for its own day. */
const priced = (over: Partial<EntryDraft> = {}) => draft({
  currency: "MAD", rate: "0.0921", rateSource: "fetched", rateCurrency: "MAD", rateDay: rateDayOf(DAY), ...over,
});

describe("rateLookupWanted", () => {
  it("asks nothing in the group's own currency", () => {
    expect(rateLookupWanted(draft(), "EUR")).toBe(false);
  });

  it("asks for a foreign currency with no rate yet, or one held for another currency", () => {
    expect(rateLookupWanted(draft({ currency: "MAD" }), "EUR")).toBe(true);
    expect(rateLookupWanted(priced({ currency: "PLN" }), "EUR")).toBe(true);
  });

  it("asks nothing once the rate is for this currency and day — an opened entry included", () => {
    expect(rateLookupWanted(priced(), "EUR")).toBe(false);
  });

  it("asks again for a new day, unless somebody typed the rate", () => {
    expect(rateLookupWanted(priced({ occurredAt: NEXT_DAY }), "EUR")).toBe(true);
    expect(rateLookupWanted(priced({ occurredAt: NEXT_DAY, rateSource: "typed" }), "EUR")).toBe(false);
  });

  it("asks again after a scan, even over a typed rate", () => {
    expect(rateLookupWanted(priced({ rateSource: "typed", rateDay: undefined }), "EUR")).toBe(true);
  });

  it("asks again over a typed rate when the currency changes", () => {
    expect(rateLookupWanted(priced({ rateSource: "typed", currency: "PLN" }), "EUR")).toBe(true);
  });
});

describe("settleRate", () => {
  const none = () => undefined;

  it("takes the feed's rate when there is one", () => {
    expect(settleRate(priced(), "MAD", { rate: "0.093", asOf: rateDayOf(DAY) }, none))
      .toEqual({ rate: "0.093", rateSource: "fetched" });
    // Today's release not out yet: the latest is the answer for today.
    expect(settleRate(priced(), "MAD", { rate: "0.093", asOf: "2000-01-01" }, none))
      .toEqual({ rate: "0.093", rateSource: "fetched" });
  });

  // The endpoint answers a day before the feed's history with its latest rate.
  it("reads an answer dated after the day as a borrow, taken last", () => {
    const later = { rate: "0.5", asOf: "2999-01-01" };
    expect(settleRate(priced({ rateSource: "typed" }), "MAD", later, none))
      .toEqual({ rate: "0.0921", rateSource: "typed" });
    expect(settleRate(draft({ currency: "MAD" }), "MAD", later, () => "0.09"))
      .toEqual({ rate: "0.09", rateSource: "copied" });
    expect(settleRate(draft({ currency: "MAD" }), "MAD", later, none))
      .toEqual({ rate: "0.5", rateSource: "copied" });
  });

  it("keeps the entry's own rate for the currency when the feed fails", () => {
    expect(settleRate(priced({ rateSource: "typed" }), "MAD", null, () => "0.5"))
      .toEqual({ rate: "0.0921", rateSource: "typed" });
  });

  it("borrows the group's latest rate when the entry has none for the currency", () => {
    expect(settleRate(priced({ currency: "PLN" }), "PLN", null, (c) => (c === "PLN" ? "0.23" : undefined)))
      .toEqual({ rate: "0.23", rateSource: "copied" });
    expect(settleRate(draft({ currency: "MAD", rate: "abc", rateCurrency: "MAD" }), "MAD", null, () => "0.09"))
      .toEqual({ rate: "0.09", rateSource: "copied" });
  });

  it("asks only for a currency new to the group with the feed out of reach", () => {
    expect(settleRate(draft({ currency: "MAD" }), "MAD", null, none)).toBeNull();
  });
});

describe("savedRateBack", () => {
  const saved = { rate: "0.0900", source: "imported" as const, currency: "MAD", day: rateDayOf(DAY) };

  it("puts an opened entry's rate back when its date comes back to its day", () => {
    // Moved to the next day, the feed's rate for it came in; then moved back.
    const d = priced({ savedRate: saved, rate: "0.0930", rateDay: rateDayOf(NEXT_DAY) });
    expect(savedRateBack(d)).toEqual({ rate: "0.0900", rateSource: "imported", rateCurrency: "MAD", rateDay: rateDayOf(DAY) });
  });

  it("does nothing on another day, another currency, or with the saved rate held", () => {
    expect(savedRateBack(priced({ savedRate: saved, occurredAt: NEXT_DAY }))).toBeNull();
    expect(savedRateBack(priced({ savedRate: saved, currency: "PLN" }))).toBeNull();
    expect(savedRateBack(priced({ savedRate: saved, rate: "0.0900", rateSource: "imported" }))).toBeNull();
    expect(savedRateBack(priced())).toBeNull();
  });

  it("leaves a rate typed for this currency", () => {
    expect(savedRateBack(priced({ savedRate: saved, rate: "0.1", rateSource: "typed" }))).toBeNull();
  });
});
