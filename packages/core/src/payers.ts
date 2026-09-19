import { resolveSplit, SplitError, splitParticipants } from "./split.js";
import type { Expense, Id, Settlement } from "./types.js";

/**
 * Co-sponsored expenses: "Bob paid 400 and Alice paid 100 for these 500".
 *
 * The mirror of the consumer side — `split` says who the money was spent *on*,
 * `payers` who handed it over. Both sum to the total exactly and both must
 * agree on every device, so both go through the same largest-remainder
 * distribution. ADR-0010.
 *
 * `payers` is optional, and `paidBy` survives beside it as the largest
 * contributor: one payer is the common case and a list row needs *one* avatar.
 *
 * Amounts are in the expense's **own** currency, because that is what people
 * handed over; converting at write time would bake a rounding decision into
 * the record and could never be shown back unchanged. `resolvePayers`
 * apportions the stored `baseAmountMinor` at read time instead, so the payer
 * side sums to the same base total the consumer side is split from.
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

/**
 * Who to show when there is room for exactly one name: the largest
 * contributor, ties broken by member id so it is stable everywhere.
 */
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

/**
 * Non-throwing check for the editor, which has to render a half-typed set of
 * payers without exploding. `null`/`undefined` — the single-payer case — is
 * always valid.
 */
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
 * What each payer put in, in the group's BASE currency, summing exactly to
 * `baseAmountMinor`. With no `payers`, the whole amount to `paidBy`; otherwise
 * apportioned by the stored contributions through the same seeded
 * largest-remainder distribution as a shares split, so the two sides can never
 * disagree by a cent. The `:payers` suffix keeps the leftover minor unit off
 * the same side of the same expense every time.
 *
 * A spec that doesn't sum to `amountMinor` is used as given rather than
 * rejected: balances must never fail to render over somebody's bad row.
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
 * Whether a member currently has a stake in this expense — paid some of it, is
 * in the split, or was marked present on its receipt. Decides whether removing
 * them would leave a live expense naming nobody the group can still edit.
 *
 * **Being on the receipt counts even where it costs nothing**: "who was there"
 * is a person saying they were at the meal, and owing zero is an outcome, not
 * an absence. Leave them out and the who-had-what grid reads their id back
 * (`app/g/entry/items`) against a member list that no longer has them.
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
 * Everything live in the group that still names this member, both kinds at
 * once. **Ask this, never one half**: a check that looks only at expenses lets
 * somebody be removed out from under a transfer, leaving a balance with
 * nothing on the other side of it. A third entry kind added here is inherited
 * by every caller.
 *
 * Deleted entries don't count: being named on something the group has thrown
 * away is not a reason to keep somebody.
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

// The detector pairing with this refusal is `liveEntriesNameLiveMembers` in
// invariants.ts, which declares the guard and its repair together. Don't add a
// second predicate here that merely happens to agree with `memberInvolved`.
