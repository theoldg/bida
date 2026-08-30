import { describe, expect, it } from "vitest";
import { assertBalanced, computeBalances, netFor } from "./balance.js";
import { foldOps } from "./fold.js";
import { settleUp, applyTransfers, transfersFor } from "./settle.js";
import { formatMinor } from "./money.js";
import { ADA, MARIE, SAM, THEO, marrakechOps, OpBuilder, GROUP } from "./fixtures.test-helper.js";

/**
 * These figures are the ones printed in design/mockups/index.html.
 * If this test fails, the mockup is out of date — fix the mockup.
 */
describe("the Marrakech trip", () => {
  const state = foldOps(marrakechOps());
  const report = computeBalances(state);

  it("spends what its expenses add up to", () => {
    expect(report.totalSpendMinor).toBe(96_314);
    expect(report.problems).toEqual([]);
  });

  it("records who paid out", () => {
    expect(report.paidMinor).toEqual({ ada: 4_421, marie: 75_039, sam: 9_210, theo: 7_644 });
  });

  it("apportions what everyone consumed", () => {
    expect(report.owedMinor).toEqual({ ada: 28_877, marie: 28_874, sam: 20_357, theo: 18_206 });
  });

  it("produces the balances shown in the mockup", () => {
    expect(report.byMember).toEqual({
      ada: -24_456,
      marie: 46_165,
      sam: -11_147,
      theo: -10_562,
    });
    expect(formatMinor(netFor(report, THEO), "EUR", { locale: "en-IE" })).toBe("-€105.62");
    expect(formatMinor(netFor(report, MARIE), "EUR", { locale: "en-IE", signDisplay: "always" }))
      .toBe("+€461.65");
  });

  it("balances to zero", () => {
    expect(() => assertBalanced(report)).not.toThrow();
  });

  it("settles in three payments, all to Marie", () => {
    const transfers = settleUp(report.byMember);
    expect(transfers).toEqual([
      { from: ADA, to: MARIE, amountMinor: 24_456 },
      { from: SAM, to: MARIE, amountMinor: 11_147 },
      { from: THEO, to: MARIE, amountMinor: 10_562 },
    ]);
    expect(Object.values(applyTransfers(report.byMember, transfers)).every((v) => v === 0)).toBe(true);
  });

  it("shows only one member's own payments", () => {
    expect(transfersFor(settleUp(report.byMember), THEO)).toHaveLength(1);
  });
});

describe("computeBalances", () => {
  it("counts a settlement as clearing debt, not as spending", () => {
    const b = new OpBuilder();
    b.push("group", GROUP, "create", { name: "g", baseCurrency: "EUR" });
    b.push("member", "a", "create", { name: "A", colorSeed: 0 });
    b.push("member", "b", "create", { name: "B", colorSeed: 0 });
    b.push("expense", "e1", "create", {
      description: "dinner", occurredAt: 0, amountMinor: 1000, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 1000, paidBy: "a",
      split: { mode: "equal", members: ["a", "b"] }, attachmentIds: [],
    });
    const before = computeBalances(foldOps(b.ops));
    expect(before.byMember).toEqual({ a: 500, b: -500 });
    expect(before.totalSpendMinor).toBe(1000);

    b.push("settlement", "s1", "create", {
      fromMember: "b", toMember: "a", amountMinor: 500, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 500, occurredAt: 0,
    });
    const after = computeBalances(foldOps(b.ops));
    expect(after.byMember).toEqual({ a: 0, b: 0 });
    expect(after.totalSpendMinor).toBe(1000);
  });

  it("ignores tombstoned expenses", () => {
    const b = new OpBuilder();
    b.push("member", "a", "create", { name: "A", colorSeed: 0 });
    b.push("member", "b", "create", { name: "B", colorSeed: 0 });
    b.push("expense", "e1", "create", {
      description: "x", occurredAt: 0, amountMinor: 1000, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 1000, paidBy: "a",
      split: { mode: "equal", members: ["a", "b"] }, attachmentIds: [],
    });
    b.push("expense", "e1", "delete", {});
    expect(computeBalances(foldOps(b.ops)).byMember).toEqual({ a: 0, b: 0 });
  });

  it("still balances when a member was deleted after spending", () => {
    const b = new OpBuilder();
    b.push("member", "a", "create", { name: "A", colorSeed: 0 });
    b.push("member", "gone", "create", { name: "Gone", colorSeed: 0 });
    b.push("expense", "e1", "create", {
      description: "x", occurredAt: 0, amountMinor: 1000, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 1000, paidBy: "a",
      split: { mode: "equal", members: ["a", "gone"] }, attachmentIds: [],
    });
    b.push("member", "gone", "delete", {});
    const report = computeBalances(foldOps(b.ops));
    expect(() => assertBalanced(report)).not.toThrow();
    expect(report.byMember["gone"]).toBe(-500);
  });

  it("reports a broken split instead of throwing the whole app away", () => {
    const b = new OpBuilder();
    b.push("member", "a", "create", { name: "A", colorSeed: 0 });
    b.push("expense", "bad", "create", {
      description: "x", occurredAt: 0, amountMinor: 1000, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 1000, paidBy: "a",
      split: { mode: "exact", amounts: { a: 1 } }, attachmentIds: [],
    });
    const report = computeBalances(foldOps(b.ops));
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]?.expenseId).toBe("bad");
    expect(report.totalSpendMinor).toBe(0);
  });
});
