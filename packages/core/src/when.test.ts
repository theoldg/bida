import { describe, expect, it } from "vitest";
import { startOfLocalDay } from "./when.js";

describe("startOfLocalDay", () => {
  const midnight = new Date(2026, 3, 4).getTime();

  it("walks a stamp back to its own midnight", () => {
    expect(startOfLocalDay(new Date(2026, 3, 4, 13, 7, 42, 8).getTime())).toBe(midnight);
    expect(startOfLocalDay(midnight)).toBe(midnight);
  });

  // The offset is the whole reason this is not arithmetic on the epoch: UTC
  // midnight is the middle of somebody's afternoon, and it is their day the
  // ledger groups by.
  it("reads the day locally, not in UTC", () => {
    const noonUtc = Date.UTC(2026, 3, 4, 12);
    expect(new Date(startOfLocalDay(noonUtc)).getDate()).toBe(new Date(noonUtc).getDate());
    expect(new Date(startOfLocalDay(noonUtc)).getHours()).toBe(0);
  });
});
