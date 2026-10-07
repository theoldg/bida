import { describe, expect, it } from "vitest";
import { pastDay } from "./rate-day";

const NOW = Date.parse("2026-10-07T12:00:00Z");

describe("pastDay", () => {
  it("passes a past day through", () => {
    expect(pastDay("2026-10-06", NOW)).toBe("2026-10-06");
    expect(pastDay("2024-03-02", NOW)).toBe("2024-03-02");
  });

  it("asks for the latest for today and later", () => {
    expect(pastDay("2026-10-07", NOW)).toBeNull();
    expect(pastDay("2027-01-01", NOW)).toBeNull();
  });

  it("refuses anything that is not a calendar day", () => {
    for (const raw of [undefined, "", "yesterday", "2026-1-5", "2026-02-30", "2026-10-06T00:00", "../latest"]) {
      expect(pastDay(raw, NOW)).toBeNull();
    }
  });
});
