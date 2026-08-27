import { resolveSplit } from "./split.js";
import { alive, type GroupState, type Id } from "./types.js";

/**
 * Balances are DERIVED on read, never stored. balance = paid − owed, in the
 * group's base currency minor units. Positive means the group owes you.
 *
 * The set always sums to zero. If it doesn't, something upstream is broken and
 * we want to know loudly rather than quietly misreport a debt.
 */

export interface BalanceReport {
  byMember: Record<Id, number>;
  /** Total spend in base currency, settlements excluded. */
  totalSpendMinor: number;
  /** Per member: what they paid out, and what they consumed. */
  paidMinor: Record<Id, number>;
  owedMinor: Record<Id, number>;
  /** Expenses we could not apportion. Rendered as a warning, never swallowed. */
  problems: { expenseId: Id; reason: string }[];
}

export function computeBalances(state: GroupState): BalanceReport {
  const byMember: Record<Id, number> = {};
  const paidMinor: Record<Id, number> = {};
  const owedMinor: Record<Id, number> = {};
  const problems: { expenseId: Id; reason: string }[] = [];
  let totalSpendMinor = 0;

  for (const m of alive(state.members)) {
    byMember[m.id] = 0;
    paidMinor[m.id] = 0;
    owedMinor[m.id] = 0;
  }
  const touch = (id: Id) => {
    // A member deleted after their expenses still has to appear, or the
    // balances stop summing to zero.
    byMember[id] ??= 0;
    paidMinor[id] ??= 0;
    owedMinor[id] ??= 0;
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
    totalSpendMinor += e.baseAmountMinor;
    touch(e.paidBy);
    paidMinor[e.paidBy] = (paidMinor[e.paidBy] ?? 0) + e.baseAmountMinor;
    byMember[e.paidBy] = (byMember[e.paidBy] ?? 0) + e.baseAmountMinor;
    for (const [id, amount] of Object.entries(shares)) {
      touch(id);
      owedMinor[id] = (owedMinor[id] ?? 0) + amount;
      byMember[id] = (byMember[id] ?? 0) - amount;
    }
  }

  // A settlement moves money without being a cost: the payer's debt shrinks.
  for (const s of alive(state.settlements)) {
    touch(s.fromMember);
    touch(s.toMember);
    byMember[s.fromMember] = (byMember[s.fromMember] ?? 0) + s.baseAmountMinor;
    byMember[s.toMember] = (byMember[s.toMember] ?? 0) - s.baseAmountMinor;
  }

  return { byMember, totalSpendMinor, paidMinor, owedMinor, problems };
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
