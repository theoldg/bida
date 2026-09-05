import { describe, expect, it } from "vitest";
import { changedFields, only, sameValue, setDerived } from "./patch";

/**
 * The merge rule, asked directly. Every case here was previously reachable
 * only by saving an entry and reading the op it appended, which is how the two
 * entry editors came to disagree about it: one wrote a derived base amount
 * whenever its inputs were touched, the other only when the figure moved, and
 * the difference is a peer's offline edit surviving or not.
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

describe("changedFields", () => {
  const stored = { description: "Dinner", amountMinor: 4000, currency: "EUR", payers: null };

  it("is empty when the form sends its whole self back unchanged", () => {
    expect(changedFields(stored, { ...stored })).toEqual({});
  });

  it("carries the one field that moved, and nothing beside it", () => {
    expect(changedFields(stored, { ...stored, amountMinor: 4500 }))
      .toEqual({ amountMinor: 4500 });
  });

  it("treats undefined as a field the caller is not editing", () => {
    // Not the same as null, which clears it: an `update` op's absent field
    // means "leave it alone", so a clear still has to write the null.
    expect(changedFields(stored, { description: undefined })).toEqual({});
    expect(changedFields({ ...stored, payers: { a: 1 } }, { payers: null }))
      .toEqual({ payers: null });
  });
});

describe("setDerived", () => {
  it("writes a recomputed field only when the figure actually moved", () => {
    const patch: Record<string, unknown> = { rateToBase: "0.0921" };
    setDerived(patch, "baseAmountMinor", 4605, 4605);
    expect(patch).toEqual({ rateToBase: "0.0921" });
    setDerived(patch, "baseAmountMinor", 4600, 4605);
    expect(patch).toEqual({ rateToBase: "0.0921", baseAmountMinor: 4600 });
  });

  it("takes back a field the diff wrote, once the recomputation says it didn't move", () => {
    // The rate is a typed field, so the diff puts it in the patch; the
    // registry then answers with the number that was already there.
    const patch: Record<string, unknown> = { rateToBase: "0.09210" };
    setDerived(patch, "rateToBase", "0.0921", "0.0921");
    expect("rateToBase" in patch).toBe(false);
  });
});
