import { describe, expect, it } from "vitest";
import {
  assertBalanced, computeBalances, entryDeltas, entryEffect, netFor, retallyBalances, tallyBalances,
} from "./balance.js";
import { foldOps } from "./fold.js";
import { emptyGroupState, type Expense, type GroupState, type Settlement } from "./types.js";
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
      { from: THEO, to: MARIE, amountMinor: 10_562 },
      { from: SAM, to: MARIE, amountMinor: 11_147 },
      { from: ADA, to: MARIE, amountMinor: 24_456 },
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
    // A "paid X · share Y" summary has to be able to reach the balance.
    expect(after.settledMinor).toEqual({ a: -500, b: 500 });
  });

  it("reads a foreign exact split in the entry's own currency and balances in the base", () => {
    const b = new OpBuilder();
    b.push("group", GROUP, "create", { name: "g", baseCurrency: "EUR" });
    b.push("member", "a", "create", { name: "A", colorSeed: 0 });
    b.push("member", "b", "create", { name: "B", colorSeed: 0 });
    b.push("expense", "e1", "create", {
      description: "tajine", occurredAt: 0, amountMinor: 100000, currency: "MAD",
      rateToBase: "0.0917", baseAmountMinor: 9170, paidBy: "a",
      split: { mode: "exact", amounts: { a: 60000, b: 40000 } }, attachmentIds: [],
    });
    const r = computeBalances(foldOps(b.ops));
    expect(r.problems).toEqual([]);
    expect(r.byMember).toEqual({ a: 3668, b: -3668 });
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

/** An income is an expense read backwards; these pin the sign where it's applied. */
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
   * Per-member terms must add back to the balance — a term left out (as
   * transfers once were) puts "paid €54.00 · share €53.50" over a balance of €13.00.
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

describe("entryEffect", () => {
  // One entry, read through `computeBalances`, so nothing else signs an income.
  const expense = (over: Partial<Expense> = {}): Expense => ({
    id: "e1", groupId: GROUP, description: "Dinner", occurredAt: 1, amountMinor: 9000, currency: "EUR",
    rateToBase: "1", baseAmountMinor: 9000, paidBy: THEO, split: { mode: "equal", members: [THEO, MARIE, ADA] },
    ...over,
  });

  it("is what you paid up and your share down, summing to what the balances say", () => {
    const e = expense();
    expect(entryEffect(e, THEO)).toEqual({ up: 9000, down: 3000, net: 6000 });
    expect(entryEffect(e, MARIE)).toEqual({ up: 0, down: 3000, net: -3000 });
    expect(entryEffect(e, SAM)).toEqual({ up: 0, down: 0, net: 0 });
  });

  it("runs an income backwards: your cut up, what you took in down", () => {
    const i = expense({ kind: "income" });
    expect(entryEffect(i, THEO)).toEqual({ up: 3000, down: 9000, net: -6000 });
    expect(entryEffect(i, MARIE)).toEqual({ up: 3000, down: 0, net: 3000 });
  });

  it("moves a transfer's sender up and its receiver down", () => {
    const t: Settlement = {
      id: "s1", groupId: GROUP, fromMember: MARIE, toMember: THEO, amountMinor: 500, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 500, occurredAt: 1,
    };
    expect(entryEffect(t, MARIE).net).toBe(500);
    expect(entryEffect(t, THEO).net).toBe(-500);
  });

  it("agrees with the whole group's balances, entry by entry", () => {
    const state = foldOps(marrakechOps());
    const whole = computeBalances(state).byMember;
    for (const id of [THEO, MARIE, SAM, ADA]) {
      const summed = Object.values(state.expenses).reduce((sum, e) => sum + entryEffect(e, id).net, 0);
      expect(summed).toBe(whole[id]);
    }
  });
});

describe("entryDeltas", () => {
  const income: Expense = {
    id: "i1", groupId: GROUP, description: "Deposit back", occurredAt: 1, amountMinor: 9000, currency: "EUR",
    rateToBase: "1", baseAmountMinor: 9000, paidBy: THEO, kind: "income",
    split: { mode: "equal", members: [THEO, MARIE, ADA] },
  };

  it("names every member an entry moves, netting to zero", () => {
    expect(entryDeltas(income)).toEqual({ [THEO]: -6000, [MARIE]: 3000, [ADA]: 3000 });
  });

  it("moves nobody on an entry nothing can apportion", () => {
    expect(entryDeltas({ ...income, split: { mode: "exact", amounts: { [THEO]: 1 } } })).toEqual({});
  });
});

describe("retallyBalances", () => {
  const PEOPLE = ["ada", "bo", "cy", "dee", "eli"];

  /** A small seeded generator, so a failure names its seed and replays. */
  function rng(seed: number) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (n: number) => Math.floor(next() * n);
    const pick = <T,>(list: readonly T[]): T => list[int(list.length)]!;
    const some = (list: readonly string[]) => list.filter(() => next() < 0.5);
    return { next, int, pick, some };
  }

  type R = ReturnType<typeof rng>;

  function expense(r: R, id: string): Expense {
    const amount = r.pick([0, 1, 7, 100, 999, 123_457, 2 ** 40]);
    const who = r.some(PEOPLE);
    const split: Expense["split"] = r.pick([
      () => ({ mode: "equal" as const, members: who }),
      () => ({ mode: "shares" as const, weights: Object.fromEntries(who.map((m) => [m, r.int(4)])) }),
      // Summing to the amount half the time: the other half is a problem.
      () => {
        const amounts = Object.fromEntries(who.map((m) => [m, r.int(amount + 1)]));
        if (who.length > 0 && r.next() < 0.5) {
          const rest = amount - Object.values(amounts).reduce((x, y) => x + y, 0) + amounts[who[0]!]!;
          amounts[who[0]!] = rest;
        }
        return { mode: "exact" as const, amounts };
      },
    ])();
    const payer = r.pick(PEOPLE);
    const other = r.pick(PEOPLE);
    const cut = r.int(amount + 1);
    return {
      id, groupId: "g", description: id, occurredAt: r.int(1000), amountMinor: amount,
      currency: "EUR", rateToBase: "1", baseAmountMinor: amount, paidBy: payer,
      payers: r.next() < 0.3 && other !== payer ? { [payer]: amount - cut, [other]: cut } : null,
      split, kind: r.next() < 0.2 ? "income" : null,
      deletedAt: r.next() < 0.15 ? 1 : null,
    };
  }

  function transfer(r: R, id: string): Settlement {
    const amount = r.pick([0, 1, 50, 10_001]);
    return {
      id, groupId: "g", fromMember: r.pick(PEOPLE), toMember: r.pick(PEOPLE), amountMinor: amount,
      currency: "EUR", rateToBase: "1", baseAmountMinor: amount, occurredAt: r.int(1000),
      deletedAt: r.next() < 0.15 ? 1 : null,
    };
  }

  function start(r: R): GroupState {
    const state = emptyGroupState();
    // Some members gone: one still named by an entry stays in the report.
    for (const id of PEOPLE.slice(0, 3)) {
      state.members[id] = { id, groupId: "g", name: id, colorSeed: 0, deletedAt: r.next() < 0.3 ? 1 : null };
    }
    for (let i = 0; i < 12; i++) state.expenses[`e${i}`] = expense(r, `e${i}`);
    for (let i = 0; i < 4; i++) state.settlements[`s${i}`] = transfer(r, `s${i}`);
    return state;
  }

  /** A save, an edit pulled in, a delete or an undelete: a few entries move. */
  function step(r: R, state: GroupState) {
    const gone: (Expense | Settlement)[] = [];
    const come: (Expense | Settlement)[] = [];
    const next = { ...state, expenses: { ...state.expenses }, settlements: { ...state.settlements } };
    for (let n = 1 + r.int(4); n > 0; n--) {
      const onTransfer = r.next() < 0.3;
      const table = onTransfer ? next.settlements : next.expenses;
      const ids = Object.keys(table);
      const id = r.next() < 0.3 || ids.length === 0 ? `${onTransfer ? "s" : "e"}${100 + r.int(1000)}` : r.pick(ids);
      // An id moving twice in one step counts once, at its first version.
      if (come.some((c) => c.id === id)) continue;
      const was = table[id];
      const now = was && r.next() < 0.4
        ? { ...was, deletedAt: was.deletedAt ? null : 2 }
        : onTransfer ? transfer(r, id) : expense(r, id);
      if (was) gone.push(was);
      come.push(now);
      (table as Record<string, Expense | Settlement>)[id] = now;
    }
    return { next, gone, come };
  }

  it("is the full tally of the state it leads to, step after step", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const r = rng(seed);
      let state = start(r);
      let tally = tallyBalances(state);
      for (let i = 0; i < 25; i++) {
        const { next, gone, come } = step(r, state);
        tally = retallyBalances(tally, gone, come);
        state = next;
        // toEqual tells 0 from -0: a stray -0 fails here.
        expect(tally, `seed ${seed}, step ${i}`).toEqual(tallyBalances(state));
      }
      assertBalanced(tally.report);
    }
  });

  it("leaves the tally it was given as it was", () => {
    const r = rng(7);
    const state = start(r);
    const tally = tallyBalances(state);
    const before = structuredClone(tally);
    const { gone, come } = step(r, state);
    retallyBalances(tally, gone, come);
    expect(tally).toEqual(before);
  });

  it("drops a removed member once nothing names them, and keeps a live one at zero", () => {
    const state = emptyGroupState();
    state.members.ada = { id: "ada", groupId: "g", name: "Ada", colorSeed: 0 };
    state.members.bo = { id: "bo", groupId: "g", name: "Bo", colorSeed: 0, deletedAt: 1 };
    const pizza: Expense = {
      id: "e1", groupId: "g", description: "Pizza", occurredAt: 0, amountMinor: 1000, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 1000, paidBy: "bo", split: { mode: "equal", members: ["ada", "bo"] },
    };
    const tally = retallyBalances(tallyBalances(state), [], [pizza]);
    expect(tally.report.byMember).toEqual({ ada: -500, bo: 500 });
    const after = retallyBalances(tally, [pizza], [{ ...pizza, deletedAt: 2 }]);
    expect(after.report.byMember).toEqual({ ada: 0 });
    expect(after.report.paidMinor).toEqual({ ada: 0 });
    expect(after.names).toEqual({ ada: 1 });
  });

  it("names a problem until it is fixed, by entry id", () => {
    const broken: Expense = {
      id: "e2", groupId: "g", description: "?", occurredAt: 0, amountMinor: 1000, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 1000, paidBy: "ada", split: { mode: "exact", amounts: { ada: 1 } },
    };
    const other = { ...broken, id: "e1" };
    const tally = retallyBalances(tallyBalances(emptyGroupState()), [], [broken, other]);
    expect(tally.report.problems.map((p) => p.expenseId)).toEqual(["e1", "e2"]);
    const fixed = { ...broken, split: { mode: "exact" as const, amounts: { ada: 1000 } } };
    const after = retallyBalances(tally, [broken], [fixed]);
    expect(after.report.problems.map((p) => p.expenseId)).toEqual(["e1"]);
    expect(after.report.totalSpendMinor).toBe(1000);
  });
});
