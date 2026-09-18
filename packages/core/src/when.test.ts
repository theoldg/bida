import { describe, expect, it } from "vitest";
import { isDateOnly, startOfLocalDay, timedStamp } from "./when.js";

const midnight = new Date(2026, 3, 4).getTime();

describe("isDateOnly", () => {
  it("is true at local midnight and false a millisecond either side", () => {
    expect(isDateOnly(midnight)).toBe(true);
    expect(isDateOnly(midnight + 1)).toBe(false);
    expect(isDateOnly(midnight - 1)).toBe(false);
    expect(isDateOnly(new Date(2026, 3, 4, 18, 22).getTime())).toBe(false);
  });

  // The offset is the whole reason this is not a modulo: UTC midnight is the
  // middle of somebody's afternoon, and it is their day the ledger draws.
  it("reads midnight locally, not in UTC", () => {
    expect(startOfLocalDay(new Date(2026, 3, 4, 13, 7).getTime())).toBe(midnight);
    expect(isDateOnly(startOfLocalDay(Date.UTC(2026, 3, 4, 11)))).toBe(true);
  });
});

describe("timedStamp", () => {
  it("leaves an ordinary clock reading alone", () => {
    const at = new Date(2026, 3, 4, 18, 22, 31, 9).getTime();
    expect(timedStamp(at)).toBe(at);
  });

  // An entry started in that one millisecond would otherwise read as a day
  // with no time: no clock on the entry screen, and the head of its own day.
  it("moves a reading that lands exactly on midnight one millisecond on", () => {
    expect(timedStamp(midnight)).toBe(midnight + 1);
    expect(isDateOnly(timedStamp(midnight))).toBe(false);
  });

  it("keeps the stamp on the day it was read", () => {
    expect(startOfLocalDay(timedStamp(midnight))).toBe(midnight);
  });
});
