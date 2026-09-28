import { describe, expect, it } from "vitest";
import { effectSum, myEffect } from "./entry-kind";

describe("effectSum", () => {
  it("is myEffect written out, for both kinds and either sign", () => {
    for (const kind of ["expense", "income"] as const) {
      for (const [putIn, share] of [[5_000, 2_000], [1_000, 3_000], [2_500, 2_500]]) {
        const { up, down, net } = effectSum(kind, putIn!, share!);
        expect(up - down).toBe(net);
        // By difference: an income that nets to nothing is -0 there, 0 here.
        expect(net - myEffect("me", { kind, putIn: putIn!, share: share! })).toBe(0);
        expect(up).toBeGreaterThanOrEqual(0);
        expect(down).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("puts an expense's payment first and an income's share first", () => {
    expect(effectSum("expense", 5_000, 2_000)).toEqual({ up: 5_000, down: 2_000, net: 3_000 });
    expect(effectSum("income", 200_000, 50_000)).toEqual({ up: 50_000, down: 200_000, net: -150_000 });
  });
});
