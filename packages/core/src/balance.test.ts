import { describe, expect, it } from "vitest";
import { assertBalanced, computeBalances, netFor } from "./balance.js";
import { foldOps } from "./fold.js";
import { settleUp, applyTransfers, transfersFor } from "./settle.js";
import { formatMinor } from "./money.js";
import { ADA, MARIE, SAM, THEO, marrakechOps, OpBuilder, GROUP } from "./fixtures.test-helper.js";

/**
 * The figures quoted in docs/testing.md. If this test fails,
 * that doc is out of date — fix the doc, not the arithmetic.
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

  it("produces the balances quoted in the docs", () => {
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
    // Named separately because a summary reading "paid X · share Y" beside a
    // balance has to be able to reach that balance; the transfer is the term
    // that used to be missing from it.
    expect(after.settledMinor).toEqual({ a: -500, b: 500 });
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

/**
 * An income is an expense read backwards. These pin the sign in the one place
 * that applies it — everything else in core treats the two identically.
 */
describe("income", () => {
  /** Two members, and whatever entries the caller adds. */
  function group(): OpBuilder {
    const b = new OpBuilder();
    b.push("group", GROUP, "create", { name: "g", baseCurrency: "EUR" });
    b.push("member", "a", "create", { name: "A", colorSeed: 0 });
    b.push("member", "b", "create", { name: "B", colorSeed: 0 });
    return b;
  }

  const entry = (extra: Record<string, unknown>) => ({
    description: "x", occurredAt: 0, amountMinor: 1000, currency: "EUR",
    rateToBase: "1", baseAmountMinor: 1000, paidBy: "a",
    split: { mode: "equal", members: ["a", "b"] }, attachmentIds: [], ...extra,
  });

  it("runs the other way: the receiver is down by it, the sharers are up", () => {
    const b = group();
    b.push("expense", "i1", "create", entry({ kind: "income" }));
    const report = computeBalances(foldOps(b.ops));
    expect(report.byMember).toEqual({ a: -500, b: 500 });
    expect(() => assertBalanced(report)).not.toThrow();
  });

  it("is exactly the negation of the same entry as an expense", () => {
    const asExpense = group();
    asExpense.push("expense", "e1", "create", entry({}));
    const asIncome = group();
    asIncome.push("expense", "e1", "create", entry({ kind: "income" }));

    const spent = computeBalances(foldOps(asExpense.ops)).byMember;
    const earned = computeBalances(foldOps(asIncome.ops)).byMember;
    for (const id of Object.keys(spent)) expect(earned[id]).toBe(-spent[id]!);
  });

  it("is counted apart from spend, never netted into it", () => {
    const b = group();
    b.push("expense", "e1", "create", entry({}));
    b.push("expense", "i1", "create", entry({ kind: "income", amountMinor: 400, baseAmountMinor: 400 }));
    const report = computeBalances(foldOps(b.ops));
    expect(report.totalSpendMinor).toBe(1000);
    expect(report.totalIncomeMinor).toBe(400);
  });

  it("keeps received and paid in separate columns", () => {
    const b = group();
    b.push("expense", "e1", "create", entry({}));
    b.push("expense", "i1", "create", entry({ kind: "income", paidBy: "b" }));
    const report = computeBalances(foldOps(b.ops));
    expect(report.paidMinor).toEqual({ a: 1000, b: 0 });
    expect(report.owedMinor).toEqual({ a: 500, b: 500 });
    expect(report.receivedMinor).toEqual({ a: 0, b: 1000 });
    expect(report.incomeShareMinor).toEqual({ a: 500, b: 500 });
    // paid − owed − received + income share, per member.
    expect(report.byMember).toEqual({ a: 1000 - 500 + 500, b: -500 - 1000 + 500 });
  });

  it("cancels an identical expense out to nothing", () => {
    const b = group();
    b.push("expense", "e1", "create", entry({}));
    b.push("expense", "i1", "create", entry({ kind: "income" }));
    expect(computeBalances(foldOps(b.ops)).byMember).toEqual({ a: 0, b: 0 });
  });

  it("shares out an odd amount exactly, same as an expense would", () => {
    const b = group();
    b.push("expense", "i1", "create",
      entry({ kind: "income", amountMinor: 1001, baseAmountMinor: 1001 }));
    const report = computeBalances(foldOps(b.ops));
    expect(report.incomeShareMinor["a"]! + report.incomeShareMinor["b"]!).toBe(1001);
    expect(() => assertBalanced(report)).not.toThrow();
  });

  it("splits over co-receivers the same way co-payers split an expense", () => {
    const b = group();
    b.push("expense", "i1", "create", entry({
      kind: "income", paidBy: "a", payers: { a: 700, b: 300 },
    }));
    const report = computeBalances(foldOps(b.ops));
    expect(report.receivedMinor).toEqual({ a: 700, b: 300 });
    expect(report.byMember).toEqual({ a: -700 + 500, b: -300 + 500 });
    expect(() => assertBalanced(report)).not.toThrow();
  });

  it("turns back into an expense when the kind is edited away", () => {
    const b = group();
    b.push("expense", "e1", "create", entry({ kind: "income" }));
    expect(computeBalances(foldOps(b.ops)).byMember).toEqual({ a: -500, b: 500 });
    b.push("expense", "e1", "update", { kind: "expense" });
    const report = computeBalances(foldOps(b.ops));
    expect(report.byMember).toEqual({ a: 500, b: -500 });
    expect(report.totalIncomeMinor).toBe(0);
    expect(report.totalSpendMinor).toBe(1000);
  });

  /**
   * The identity every per-member summary is built on. It is the one that
   * broke: transfers moved `byMember` while appearing in no named term, so a
   * card reading "paid €54.00 · share €53.50" sat under a balance of €13.00.
   * All four terms have to be here, or the missing one is the bug again.
   */
  it("splits every balance into terms that add back up to it", () => {
    const b = group();
    b.push("expense", "e1", "create", entry({}));
    b.push("expense", "i1", "create", entry({ kind: "income", paidBy: "b" }));
    b.push("settlement", "s1", "create", {
      fromMember: "b", toMember: "a", amountMinor: 250, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 250, occurredAt: 0,
    });
    const r = computeBalances(foldOps(b.ops));
    expect(r.settledMinor).toEqual({ a: -250, b: 250 });
    for (const [id, net] of Object.entries(r.byMember)) {
      expect([id, net]).toEqual([id,
        (r.paidMinor[id] ?? 0) - (r.owedMinor[id] ?? 0)
        - (r.receivedMinor[id] ?? 0) + (r.incomeShareMinor[id] ?? 0)
        + (r.settledMinor[id] ?? 0)]);
    }
    // Every term has to be doing work, or the identity holds for the wrong reason.
    for (const t of [r.paidMinor, r.owedMinor, r.receivedMinor, r.incomeShareMinor, r.settledMinor]) {
      expect(Object.values(t).some((v) => v !== 0)).toBe(true);
    }
  });

  it("settles up as ordinary balances — a transfer clears an income too", () => {
    const b = group();
    b.push("expense", "i1", "create", entry({ kind: "income" }));
    const report = computeBalances(foldOps(b.ops));
    const transfers = settleUp(report.byMember);
    expect(transfers).toEqual([{ from: "a", to: "b", amountMinor: 500 }]);
    expect(Object.values(applyTransfers(report.byMember, transfers)).every((v) => v === 0)).toBe(true);
  });
});
