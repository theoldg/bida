import { describe, expect, it } from "vitest";
import {
  entriesInvolving, expenseInvolves, isCoSponsored, memberInvolved, payerList,
  primaryPayer, resolvePayers, settlementInvolves, validatePayers,
} from "./payers.js";
import { computeBalances, assertBalanced } from "./balance.js";
import { emptyGroupState, type Expense, type Member, type Settlement } from "./types.js";

const BOB = "m-bob";
const ALICE = "m-alice";
const CARL = "m-carl";

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: "e-1", groupId: "g", description: "Dinner", occurredAt: 1,
    amountMinor: 50_000, currency: "EUR", rateToBase: "1", baseAmountMinor: 50_000,
    paidBy: BOB, split: { mode: "equal", members: [BOB, ALICE, CARL] },
    attachmentIds: [], ...over,
  };
}

function member(id: string, name: string): Member {
  return { id, groupId: "g", name, colorSeed: 1 };
}

describe("payerList / primaryPayer / isCoSponsored", () => {
  it("falls back to paidBy when there are no payers", () => {
    const e = expense();
    expect(payerList(e)).toEqual([BOB]);
    expect(isCoSponsored(e)).toBe(false);
  });

  it("ignores zero contributions, and falls back if all are zero", () => {
    expect(payerList(expense({ payers: { [BOB]: 40_000, [ALICE]: 0 } }))).toEqual([BOB]);
    expect(payerList(expense({ payers: { [BOB]: 0, [ALICE]: 0 } }))).toEqual([BOB]);
  });

  it("names two payers as co-sponsored", () => {
    const e = expense({ payers: { [BOB]: 40_000, [ALICE]: 10_000 } });
    expect(payerList(e)).toEqual([ALICE, BOB]);
    expect(isCoSponsored(e)).toBe(true);
  });

  it("picks the largest contributor, ties by id", () => {
    expect(primaryPayer({ [BOB]: 40_000, [ALICE]: 10_000 }, CARL)).toBe(BOB);
    expect(primaryPayer({ [BOB]: 25_000, [ALICE]: 25_000 }, CARL)).toBe(ALICE);
    expect(primaryPayer({}, CARL)).toBe(CARL);
  });
});

describe("expenseInvolves", () => {
  it("is true for the split, true for a payer, false for neither", () => {
    const e = expense({ split: { mode: "equal", members: [BOB, ALICE] } });
    expect(expenseInvolves(e, BOB)).toBe(true);
    expect(expenseInvolves(e, ALICE)).toBe(true);
    expect(expenseInvolves(e, CARL)).toBe(false);
  });

  it("counts a co-sponsor even when they're not in the split", () => {
    const e = expense({
      payers: { [BOB]: 40_000, [CARL]: 10_000 },
      split: { mode: "equal", members: [BOB, ALICE] },
    });
    expect(expenseInvolves(e, CARL)).toBe(true);
  });

  it("stops counting someone edited out of both sides", () => {
    const e = expense({
      paidBy: BOB,
      split: { mode: "equal", members: [BOB] },
    });
    expect(expenseInvolves(e, ALICE)).toBe(false);
  });
});

function settlement(over: Partial<Settlement> = {}): Settlement {
  return {
    id: "s-1", groupId: "g", fromMember: ALICE, toMember: BOB,
    amountMinor: 5_000, currency: "EUR", rateToBase: "1", baseAmountMinor: 5_000,
    occurredAt: 1, ...over,
  };
}

describe("settlementInvolves / memberInvolved", () => {
  it("counts both sides of a transfer and nobody else", () => {
    const s = settlement();
    expect(settlementInvolves(s, ALICE)).toBe(true);
    expect(settlementInvolves(s, BOB)).toBe(true);
    expect(settlementInvolves(s, CARL)).toBe(false);
  });

  // The bug this pair exists for: the members screen asked about expenses
  // only, so a transfer to somebody was no obstacle to removing them — and
  // the group was left showing a balance with nothing on the other side.
  it("sees a member who is only in a transfer", () => {
    const tables = { expenses: [], settlements: [settlement({ fromMember: ALICE, toMember: BOB })] };

    expect(memberInvolved(tables, BOB)).toBe(true);
    expect(entriesInvolving(tables, BOB).settlements).toHaveLength(1);
    expect(memberInvolved(tables, CARL)).toBe(false);
  });

  it("sees a member who is only in an expense", () => {
    const tables = {
      expenses: [expense({ split: { mode: "equal", members: [BOB, ALICE] } })],
      settlements: [],
    };

    expect(memberInvolved(tables, ALICE)).toBe(true);
    expect(entriesInvolving(tables, ALICE).expenses).toHaveLength(1);
  });

  it("ignores deleted entries of either kind", () => {
    const tables = {
      expenses: [expense({ deletedAt: 5 })],
      settlements: [settlement({ deletedAt: 5 })],
    };

    expect(memberInvolved(tables, BOB)).toBe(false);
    expect(memberInvolved(tables, ALICE)).toBe(false);
  });
});

describe("validatePayers", () => {
  it("accepts the single-payer case", () => {
    expect(validatePayers(50_000, null).ok).toBe(true);
    expect(validatePayers(50_000, undefined).ok).toBe(true);
  });

  it("accepts contributions that sum to the amount", () => {
    expect(validatePayers(50_000, { [BOB]: 40_000, [ALICE]: 10_000 }).ok).toBe(true);
  });

  it("reports the shortfall and the overshoot", () => {
    const short = validatePayers(50_000, { [BOB]: 40_000 });
    expect(short.ok).toBe(false);
    expect(short.allocatedMinor).toBe(40_000);
    expect(short.problem).toBe("under");
    expect(short.diffMinor).toBe(10_000);

    const over = validatePayers(50_000, { [BOB]: 40_000, [ALICE]: 20_000 });
    expect(over.ok).toBe(false);
    expect(over.problem).toBe("over");
    expect(over.diffMinor).toBe(-10_000);
    // Both sentences are currency-free; the editor formats the number itself.
    for (const v of [short, over]) expect(v.message).not.toMatch(/minor units|\d/);
  });

  it("refuses negatives, non-integers, and an all-zero set", () => {
    expect(validatePayers(500, { [BOB]: -100, [ALICE]: 600 }).ok).toBe(false);
    expect(validatePayers(500, { [BOB]: 12.5, [ALICE]: 487.5 }).ok).toBe(false);
    expect(validatePayers(500, { [BOB]: 0 }).ok).toBe(false);
  });
});

describe("resolvePayers", () => {
  it("gives the whole amount to paidBy when there are no payers", () => {
    expect(resolvePayers(expense())).toEqual({ [BOB]: 50_000 });
  });

  it("returns the stored amounts unchanged in the base currency", () => {
    const e = expense({ payers: { [BOB]: 40_000, [ALICE]: 10_000 } });
    expect(resolvePayers(e)).toEqual({ [BOB]: 40_000, [ALICE]: 10_000 });
  });

  it("apportions a converted total so it sums to baseAmountMinor exactly", () => {
    // 620 MAD at 0,0918 -> 5691 minor EUR, put in 400/220 by two people.
    const e = expense({
      amountMinor: 62_000, currency: "MAD", rateToBase: "0.0918", baseAmountMinor: 5_691,
      payers: { [BOB]: 40_000, [ALICE]: 22_000 },
    });
    const shares = resolvePayers(e);
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(5_691);
    // Proportional to what each actually handed over, to the minor unit.
    expect(shares[BOB]).toBe(3_672);
    expect(shares[ALICE]).toBe(2_019);
  });

  it("never fails to produce an exact total, even on a spec that doesn't add up", () => {
    const e = expense({ payers: { [BOB]: 3, [ALICE]: 1 } }); // sums to 4, not 50 000
    const shares = resolvePayers(e);
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(50_000);
  });

  it("falls back to paidBy if every weight is zero", () => {
    // payerList already collapses this to [paidBy]; belt and braces.
    expect(resolvePayers(expense({ payers: { [BOB]: 0, [ALICE]: 0 } })))
      .toEqual({ [BOB]: 50_000 });
  });
});

describe("balances with co-sponsors", () => {
  const state = () => ({
    ...emptyGroupState(),
    group: { id: "g", name: "G", baseCurrency: "EUR", createdAt: 0 },
    members: {
      [BOB]: member(BOB, "Bob"), [ALICE]: member(ALICE, "Alice"), [CARL]: member(CARL, "Carl"),
    },
  });

  it("credits each payer what they put in", () => {
    const e = expense({ payers: { [BOB]: 40_000, [ALICE]: 10_000 } });
    const report = computeBalances({ ...state(), expenses: { [e.id]: e } });
    assertBalanced(report);
    expect(report.paidMinor[BOB]).toBe(40_000);
    expect(report.paidMinor[ALICE]).toBe(10_000);
    expect(report.paidMinor[CARL]).toBe(0);
    // Everyone consumes a third of 500,00 = 166,66/166,67.
    expect(report.owedMinor[BOB]! + report.owedMinor[ALICE]! + report.owedMinor[CARL]!)
      .toBe(50_000);
    expect(report.byMember[BOB]).toBe(40_000 - report.owedMinor[BOB]!);
    expect(report.byMember[ALICE]).toBe(10_000 - report.owedMinor[ALICE]!);
  });

  it("is identical to a single payer when payers name only them", () => {
    const one = expense();
    const same = expense({ payers: { [BOB]: 50_000 } });
    const a = computeBalances({ ...state(), expenses: { [one.id]: one } });
    const b = computeBalances({ ...state(), expenses: { [same.id]: same } });
    expect(b.byMember).toEqual(a.byMember);
    expect(b.paidMinor).toEqual(a.paidMinor);
  });

  it("credits a payer who consumed nothing", () => {
    // Bob and Alice pay for a dinner they weren't at.
    const e = expense({
      split: { mode: "equal", members: [CARL] },
      payers: { [BOB]: 40_000, [ALICE]: 10_000 },
    });
    const report = computeBalances({ ...state(), expenses: { [e.id]: e } });
    assertBalanced(report);
    expect(report.byMember[CARL]).toBe(-50_000);
    expect(report.byMember[BOB]).toBe(40_000);
    expect(report.byMember[ALICE]).toBe(10_000);
  });

  it("still balances across a hundred randomised co-sponsored expenses", () => {
    const ids = [BOB, ALICE, CARL];
    const expenses: Record<string, Expense> = {};
    for (let i = 0; i < 100; i++) {
      const total = 1 + Math.floor(Math.random() * 100_000);
      const a = Math.floor(Math.random() * total);
      const e = expense({
        id: `e-${i}`,
        amountMinor: total,
        baseAmountMinor: total,
        payers: { [BOB]: a, [ALICE]: total - a },
        split: { mode: "shares", weights: Object.fromEntries(
          ids.map((id) => [id, 1 + Math.floor(Math.random() * 3)]),
        ) },
      });
      expenses[e.id] = e;
    }
    assertBalanced(computeBalances({ ...state(), expenses }));
  });
});
