import { describe, expect, it } from "vitest";
import { tapAmount } from "./tap-amount";

describe("tapAmount", () => {
  it("clears a row that holds a figure", () => {
    expect(tapAmount({ a: 700, b: 300 }, "a", 1000)).toEqual({ set: 0 });
  });

  it("clears it even when the column is over", () => {
    expect(tapAmount({ a: 700, b: 900 }, "b", 1000)).toEqual({ set: 0 });
  });

  it("hands an empty row what is left", () => {
    expect(tapAmount({ a: 700 }, "b", 1000)).toEqual({ set: 300 });
  });

  it("hands the whole total to the first row tapped", () => {
    expect(tapAmount({}, "a", 1000)).toEqual({ set: 1000 });
  });

  it("counts an explicit zero as empty", () => {
    expect(tapAmount({ a: 0, b: 250 }, "a", 1000)).toEqual({ set: 750 });
  });

  it("edits when the column is exactly full", () => {
    expect(tapAmount({ a: 1000 }, "b", 1000)).toBe("edit");
  });

  it("edits when the column is over", () => {
    expect(tapAmount({ a: 1200 }, "b", 1000)).toBe("edit");
  });

  it("edits when there is no total to take from", () => {
    expect(tapAmount({}, "a", 0)).toBe("edit");
  });
});
