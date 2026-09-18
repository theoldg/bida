import { describe, expect, it } from "vitest";
import { only, sameValue } from "./patch";

/**
 * The merge rule, asked directly. Every case here was previously reachable
 * only by saving an entry and reading the op it appended, which is how the two
 * entry editors came to disagree about it in the first place.
 */

describe("only", () => {
  it("drops what a create would only be defaulting", () => {
    expect(only({ receiptItems: null, categoryId: undefined, attachmentIds: [] })).toEqual({});
  });

  it("keeps a value that says something, including a falsy one", () => {
    // 0 and "" are answers. Absent is the one that isn't.
    expect(only({ occurredAt: 0, note: "", splitTab: "receipt" }))
      .toEqual({ occurredAt: 0, note: "", splitTab: "receipt" });
  });
});

describe("sameValue", () => {
  it("reads null and absent as one value", () => {
    // `only()` leaves an unset field off the create entirely while the form
    // sends an explicit null for it. Reading those as different wrote a
    // phantom revision on every first edit.
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue(null, 0)).toBe(false);
  });

  it("ignores the order keys happen to be in", () => {
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameValue({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
  });

  it("does not ignore the order elements are in", () => {
    // A split's members are an array, and swapping two of them is not a
    // change a person can see — which is why the expense editor canonicalises
    // the split before it gets here rather than asking this to be cleverer.
    expect(sameValue(["a", "b"], ["b", "a"])).toBe(false);
  });
});
