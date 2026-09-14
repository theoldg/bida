import { describe, expect, it } from "vitest";
import { applyTransfers, settleUp } from "./settle.js";

/**
 * The minimum, worked out a different way from settle.ts: recursively peel off
 * every zero-sum group that contains the first member and keep the cut that
 * yields the most groups. Too slow for the app, fine for eight people.
 */
function bruteForceMinimum(balances: Record<string, number>): number {
  const v = Object.values(balances).filter((x) => x !== 0);
  const most = (rest: number[]): number => {
    if (rest.length === 0) return 0;
    const [head, ...tail] = rest as [number, ...number[]];
    let best = -Infinity;
    for (let mask = 0; mask < 1 << tail.length; mask++) {
      const group = tail.filter((_, i) => (mask >> i) & 1);
      if (head + group.reduce((a, b) => a + b, 0) !== 0) continue;
      const left = tail.filter((_, i) => !((mask >> i) & 1));
      best = Math.max(best, 1 + most(left));
    }
    return best;
  };
  return v.length - most(v);
}

describe("settleUp", () => {
  it("returns nothing when everyone is square", () => {
    expect(settleUp({ a: 0, b: 0 })).toEqual([]);
  });

  it("handles the simple two-person case", () => {
    expect(settleUp({ a: 500, b: -500 })).toEqual([{ from: "b", to: "a", amountMinor: 500 }]);
  });

  it("uses the fewest transfers there are", () => {
    // Nobody is squared off against anyone, so it takes all three.
    expect(settleUp({ a: 1000, b: 500, c: -400, d: -600, e: -500 })).toHaveLength(3);
    // c and d cancel exactly: that is a group of its own, and one payment.
    expect(settleUp({ a: 1000, b: 500, c: -400, d: 400, e: -1500 })).toHaveLength(3);
  });

  it("matches a brute-force minimum on every random group", () => {
    let seed = 4242;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let round = 0; round < 2000; round++) {
      const n = 2 + Math.floor(rand() * 7);
      const balances: Record<string, number> = {};
      let running = 0;
      for (let i = 0; i < n - 1; i++) {
        // Few distinct amounts, so exact matches and cancelling subsets are
        // common — that is where a greedy pass loses to the minimum.
        const v = (1 + Math.floor(rand() * 4)) * 100 * (rand() < 0.5 ? -1 : 1);
        balances[`m${i}`] = v;
        running += v;
      }
      balances[`m${n - 1}`] = -running;

      expect(settleUp(balances)).toHaveLength(bruteForceMinimum(balances));
    }
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

  it("still clears a group too large for the exact pass", () => {
    // 20 members is past EXACT_LIMIT: the cut is skipped, so this is only the
    // greedy fill — which must still square everyone off.
    const balances: Record<string, number> = {};
    let running = 0;
    for (let i = 0; i < 19; i++) {
      balances[`m${i}`] = (i % 2 ? 1 : -1) * (i + 1) * 137;
      running += balances[`m${i}`]!;
    }
    balances.m19 = -running;
    const transfers = settleUp(balances);
    expect(transfers.length).toBeLessThanOrEqual(19);
    expect(Object.values(applyTransfers(balances, transfers)).every((v) => v === 0)).toBe(true);
  });

  it("is deterministic given equal amounts", () => {
    const balances = { z: -100, a: -100, m: 200 };
    expect(settleUp(balances)).toEqual(settleUp({ ...balances }));
    expect(settleUp(balances)[0]?.from).toBe("a");
  });
});
