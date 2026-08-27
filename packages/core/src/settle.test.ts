import { describe, expect, it } from "vitest";
import { applyTransfers, settleUp } from "./settle.js";

describe("settleUp", () => {
  it("returns nothing when everyone is square", () => {
    expect(settleUp({ a: 0, b: 0 })).toEqual([]);
  });

  it("handles the simple two-person case", () => {
    expect(settleUp({ a: 500, b: -500 })).toEqual([{ from: "b", to: "a", amountMinor: 500 }]);
  });

  it("uses at most n-1 transfers", () => {
    const balances = { a: 1000, b: 500, c: -400, d: -600, e: -500 };
    const transfers = settleUp(balances);
    expect(transfers.length).toBeLessThanOrEqual(Object.keys(balances).length - 1);
  });

  it("always clears every balance to zero", () => {
    let seed = 99;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let round = 0; round < 300; round++) {
      const n = 2 + Math.floor(rand() * 7);
      const balances: Record<string, number> = {};
      let running = 0;
      for (let i = 0; i < n - 1; i++) {
        const v = Math.floor((rand() - 0.5) * 200_000);
        balances[`m${i}`] = v;
        running += v;
      }
      balances[`m${n - 1}`] = -running;

      const settled = applyTransfers(balances, settleUp(balances));
      expect(Object.values(settled).every((v) => v === 0)).toBe(true);
    }
  });

  it("is deterministic given equal amounts", () => {
    const balances = { z: -100, a: -100, m: 200 };
    expect(settleUp(balances)).toEqual(settleUp({ ...balances }));
    expect(settleUp(balances)[0]?.from).toBe("a");
  });
});
