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

  it("gives a small debtor one transfer, and splits the big one instead", () => {
    // b owes a little, a owes a lot; no single creditor can absorb a. The old
    // biggest-first pass paid a into both creditors and then left b with the
    // remainder of one of them — two transfers for the person owing least.
    const transfers = settleUp({ a: -900, b: -100, c: 500, d: 500 });
    expect(transfers.filter((t) => t.from === "b")).toHaveLength(1);
    expect(transfers.filter((t) => t.from === "a")).toHaveLength(2);
  });

  it("never splits the smallest debtor when anyone can absorb them whole", () => {
    let seed = 7;
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

      const biggestCredit = Math.max(0, ...Object.values(balances));
      const debts = Object.entries(balances).filter(([, v]) => v < 0);
      if (debts.length === 0) continue;
      // Whoever owes least is served first, against creditors nothing has
      // touched yet — so one payment, unless the group's largest single credit
      // is smaller than even that debt.
      const [id, balance] = debts.sort(([a, x], [b, y]) => x - y || (a < b ? 1 : -1)).at(-1)!;
      if (-balance > biggestCredit) continue;
      expect(settleUp(balances).filter((t) => t.from === id)).toHaveLength(1);
    }
  });

  it("is deterministic given equal amounts", () => {
    const balances = { z: -100, a: -100, m: 200 };
    expect(settleUp(balances)).toEqual(settleUp({ ...balances }));
    expect(settleUp(balances)[0]?.from).toBe("a");
  });
});
