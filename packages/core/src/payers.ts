import { resolveSplit, SplitError, splitParticipants } from "./split.js";
import type { Expense, Id, Settlement } from "./types.js";

/**
 * Co-paid expenses ("Bob paid 400 and Alice 100"). The mirror of `split`, via
 * the same largest-remainder distribution so every device agrees. `paidBy`
 * stays as the largest payer: a row needs one avatar. ADR-0010.
 *
 * Amounts are in the expense's **own** currency, as handed over; `resolvePayers`
 * apportions `baseAmountMinor` at read time, so both sides sum to the same total.
 */

/** memberId -> amount in the expense's OWN currency. Sums to `amountMinor`. */
type PayerSpec = Record<Id, number>;

/** The payer fields of an expense — everything these functions need, no more. */
interface PayerBearing {
  id: Id;
  amountMinor: number;
  baseAmountMinor: number;
  paidBy: Id;
  payers?: PayerSpec | null;
}

/** Payers with a non-zero contribution, sorted. Falls back to `[paidBy]`. */
export function payerList(expense: PayerBearing): Id[] {
  const spec = expense.payers;
  if (!spec) return [expense.paidBy];
  const ids = Object.keys(spec).filter((id) => (spec[id] ?? 0) !== 0).sort();
  return ids.length === 0 ? [expense.paidBy] : ids;
}

/** More than one person put money in. Drives "Bob + 1 other paid". */
export function isCoSponsored(expense: PayerBearing): boolean {
  return payerList(expense).length > 1;
}

/** The one name to show: the largest contributor, ties by id. */
export function primaryPayer(spec: PayerSpec, fallback: Id): Id {
  const ids = Object.keys(spec).filter((id) => (spec[id] ?? 0) !== 0);
  if (ids.length === 0) return fallback;
  return ids.sort((a, b) => (spec[b] ?? 0) - (spec[a] ?? 0) || (a < b ? -1 : 1))[0]!;
}

/** Same shape, same reasoning as `SplitProblem` — see split.ts. */
type PayerProblem = "empty" | "under" | "over" | "invalid";

export interface PayerValidation {
  ok: boolean;
  /** What the payers currently add up to, in the expense's own currency. */
  allocatedMinor: number;
  totalMinor: number;
  problem?: PayerProblem;
  /** What is still unaccounted for; negative when the payers overshoot. */
  diffMinor?: number;
  /** A fallback sentence for callers with no currency to hand. */
  message?: string;
}

/** Non-throwing check for the editor. `null`/`undefined` (one payer) is always valid. */
export function validatePayers(
  amountMinor: number,
  spec: PayerSpec | null | undefined,
): PayerValidation {
  if (!spec) return { ok: true, allocatedMinor: amountMinor, totalMinor: amountMinor };

  const ids = Object.keys(spec);
  let sum = 0;
  for (const id of ids) {
    const v = spec[id] ?? 0;
    if (!Number.isSafeInteger(v)) {
      return { ok: false, allocatedMinor: 0, totalMinor: amountMinor, problem: "invalid",
        message: `${id}'s contribution must be a whole number of minor units` };
    }
    if (v < 0) {
      return { ok: false, allocatedMinor: 0, totalMinor: amountMinor, problem: "invalid",
        message: "Nobody can pay a negative amount" };
    }
    sum += v;
  }
  if (sum === 0) {
    return { ok: false, allocatedMinor: 0, totalMinor: amountMinor, problem: "empty",
      diffMinor: amountMinor, message: "Nobody has put anything in yet" };
  }
  if (sum !== amountMinor) {
    const diff = amountMinor - sum;
    return {
      ok: false, allocatedMinor: sum, totalMinor: amountMinor,
      problem: diff > 0 ? "under" : "over",
      diffMinor: diff,
      message: diff > 0 ? "Some of it is still unaccounted for"
                        : "That is more than the expense",
    };
  }
  return { ok: true, allocatedMinor: sum, totalMinor: amountMinor };
}

/**
 * What each payer put in, in BASE currency, summing to `baseAmountMinor` —
 * the shares-split distribution with a `:payers` seed suffix. A spec that
 * doesn't sum is used as given: balances must render despite a bad row.
 */
export function resolvePayers(expense: PayerBearing): Record<Id, number> {
  const ids = payerList(expense);
  if (ids.length === 1) return { [ids[0]!]: expense.baseAmountMinor };

  const weights: Record<Id, number> = {};
  for (const id of ids) weights[id] = Math.abs(expense.payers?.[id] ?? 0);

  try {
    return resolveSplit(expense.baseAmountMinor, { mode: "shares", weights }, {
      tiebreakSeed: `${expense.id}:payers`,
    }).shares;
  } catch (err) {
    if (err instanceof SplitError) return { [expense.paidBy]: expense.baseAmountMinor };
    throw err;
  }
}

/**
 * Whether a member has a stake in this expense: paid, in the split, or marked
 * present on its receipt — the last even at zero cost, or the grid would read
 * back an id the member list no longer has.
 */
export function expenseInvolves(expense: Expense, memberId: Id): boolean {
  return payerList(expense).includes(memberId)
    || splitParticipants(expense.split).includes(memberId)
    || (expense.receiptInvolved?.includes(memberId) ?? false)
    || (expense.receiptAssignments?.some((row) => row.includes(memberId)) ?? false);
}

/** The transfer half of the same question: they are one of the two sides. */
export function settlementInvolves(settlement: Settlement, memberId: Id): boolean {
  return settlement.fromMember === memberId || settlement.toMember === memberId;
}

/** Both entry tables of a group, which is what every caller of the two below holds. */
interface EntryTables {
  expenses: readonly Expense[];
  settlements: readonly Settlement[];
}

/**
 * Every live entry naming this member, both kinds. **Ask this, never one
 * half**: checking only expenses lets somebody be removed from under a
 * transfer. Deleted entries don't count.
 */
export function entriesInvolving(
  entries: EntryTables, memberId: Id,
): { expenses: Expense[]; settlements: Settlement[] } {
  return {
    expenses: entries.expenses.filter((e) => !e.deletedAt && expenseInvolves(e, memberId)),
    settlements: entries.settlements.filter((s) => !s.deletedAt && settlementInvolves(s, memberId)),
  };
}

/** Whether anything at all still names them. `entriesInvolving`, as a verdict. */
export function memberInvolved(entries: EntryTables, memberId: Id): boolean {
  const { expenses, settlements } = entriesInvolving(entries, memberId);
  return expenses.length > 0 || settlements.length > 0;
}

// The paired detector is `liveEntriesNameLiveMembers` in invariants.ts. Don't
// add a second predicate here that merely agrees with `memberInvolved`.
