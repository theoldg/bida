import { resolvePayers } from "./payers.js";
import { resolveSplit } from "./split.js";
import { alive, type GroupState, type Id } from "./types.js";

/**
 * Balances are DERIVED on read, never stored. balance = paid − owed, in the
 * group's base currency minor units. Positive means the group owes you.
 *
 * The set always sums to zero. If it doesn't, something upstream is broken and
 * we want to know loudly rather than quietly misreport a debt.
 *
 * An **income** is an expense read backwards, and this is the one place that
 * knows it: whoever took the money in is down by it, and everybody it was
 * shared with is up by their share. Nothing else in core branches on
 * `Expense.kind` — the amount, the payer map and the split are the same
 * positive arithmetic either way (ADR-0010).
 */

export interface BalanceReport {
  byMember: Record<Id, number>;
  /** Total spend in base currency: expenses only, transfers and income excluded. */
  totalSpendMinor: number;
  /** What the group took in, in base currency. The mirror of `totalSpendMinor`. */
  totalIncomeMinor: number;
  /** Per member: what they paid out for expenses, and what they consumed. */
  paidMinor: Record<Id, number>;
  owedMinor: Record<Id, number>;
  /** Per member: what they took in on the group's behalf, and their cut of it. */
  receivedMinor: Record<Id, number>;
  incomeShareMinor: Record<Id, number>;
  /**
   * Per member: what transfers did to their balance — sent minus received.
   * `byMember` has always counted it; without it named here a summary built
   * from `paidMinor` and `owedMinor` cannot reach the figure beside it.
   */
  settledMinor: Record<Id, number>;
  /** Entries we could not apportion. Rendered as a warning, never swallowed. */
  problems: { expenseId: Id; reason: string }[];
}

export function computeBalances(state: GroupState): BalanceReport {
  const byMember: Record<Id, number> = {};
  const paidMinor: Record<Id, number> = {};
  const owedMinor: Record<Id, number> = {};
  const receivedMinor: Record<Id, number> = {};
  const incomeShareMinor: Record<Id, number> = {};
  const settledMinor: Record<Id, number> = {};
  const problems: { expenseId: Id; reason: string }[] = [];
  let totalSpendMinor = 0;
  let totalIncomeMinor = 0;

  for (const m of alive(state.members)) {
    byMember[m.id] = 0;
    paidMinor[m.id] = 0;
    owedMinor[m.id] = 0;
    receivedMinor[m.id] = 0;
    incomeShareMinor[m.id] = 0;
    settledMinor[m.id] = 0;
  }
  const touch = (id: Id) => {
    // A member deleted after their expenses still has to appear, or the
    // balances stop summing to zero.
    byMember[id] ??= 0;
    paidMinor[id] ??= 0;
    owedMinor[id] ??= 0;
    receivedMinor[id] ??= 0;
    incomeShareMinor[id] ??= 0;
    settledMinor[id] ??= 0;
  };

  for (const e of alive(state.expenses)) {
    let shares: Record<Id, number>;
    try {
      // Seeded with the expense id so leftover cents rotate between
      // members instead of always landing on the same person.
      shares = resolveSplit(e.baseAmountMinor, e.split, { tiebreakSeed: e.id }).shares;
    } catch (err) {
      problems.push({
        expenseId: e.id,
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const income = e.kind === "income";
    if (income) totalIncomeMinor += e.baseAmountMinor;
    else totalSpendMinor += e.baseAmountMinor;

    // Credit every payer. With no co-sponsors this is one entry for `paidBy`
    // carrying the whole amount, exactly as before payers existed. On an
    // income the same map names who *received* it, and it runs the other way.
    for (const [id, amount] of Object.entries(resolvePayers(e))) {
      touch(id);
      if (income) {
        receivedMinor[id] = (receivedMinor[id] ?? 0) + amount;
        byMember[id] = (byMember[id] ?? 0) - amount;
      } else {
        paidMinor[id] = (paidMinor[id] ?? 0) + amount;
        byMember[id] = (byMember[id] ?? 0) + amount;
      }
    }
    for (const [id, amount] of Object.entries(shares)) {
      touch(id);
      if (income) {
        incomeShareMinor[id] = (incomeShareMinor[id] ?? 0) + amount;
        byMember[id] = (byMember[id] ?? 0) + amount;
      } else {
        owedMinor[id] = (owedMinor[id] ?? 0) + amount;
        byMember[id] = (byMember[id] ?? 0) - amount;
      }
    }
  }

  // A transfer moves money without being a cost: the payer's debt shrinks.
  for (const s of alive(state.settlements)) {
    touch(s.fromMember);
    touch(s.toMember);
    byMember[s.fromMember] = (byMember[s.fromMember] ?? 0) + s.baseAmountMinor;
    byMember[s.toMember] = (byMember[s.toMember] ?? 0) - s.baseAmountMinor;
    settledMinor[s.fromMember] = (settledMinor[s.fromMember] ?? 0) + s.baseAmountMinor;
    settledMinor[s.toMember] = (settledMinor[s.toMember] ?? 0) - s.baseAmountMinor;
  }

  return {
    byMember, totalSpendMinor, totalIncomeMinor,
    paidMinor, owedMinor, receivedMinor, incomeShareMinor, settledMinor, problems,
  };
}

/** Balances must sum to zero. Call it in dev; it catches real bugs. */
export function assertBalanced(report: BalanceReport): void {
  const sum = Object.values(report.byMember).reduce((a, b) => a + b, 0);
  if (sum !== 0) {
    throw new Error(`balances do not sum to zero (off by ${sum} minor units)`);
  }
}

/** The one number the app exists for, from one member's point of view. */
export function netFor(report: BalanceReport, memberId: Id): number {
  return report.byMember[memberId] ?? 0;
}
