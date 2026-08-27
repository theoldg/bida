import { resolveSplit, SplitError } from "./split.js";
import type { Expense, Id } from "./types.js";

/**
 * Co-sponsored expenses: "Bob paid 400 and Alice paid 100 for these 500".
 *
 * The payer side of an expense is the mirror of the consumer side. `split` says
 * who the money was spent *on*; `payers` says who actually handed it over. Both
 * have to sum to the total exactly, and both have to give the same answer on
 * every device — so both go through the same largest-remainder distribution.
 *
 * ## Why `paidBy` survives
 *
 * One payer is overwhelmingly the common case, every op already written in
 * every existing log carries `paidBy`, and a row in a list needs *one* avatar.
 * So `payers` is additive and optional: absent, the expense means exactly what
 * it always meant. Present, it wins, and `paidBy` is kept in step as the
 * largest contributor so an older client — or a narrow list row — still has a
 * sensible answer instead of a wrong one.
 *
 * ## Why amounts are in the expense's own currency
 *
 * People hand over the currency on the receipt. Storing 400 MAD and 100 MAD is
 * what happened; storing their converted equivalents would bake a rounding
 * decision into the record and could not be shown back to anyone unchanged.
 * `resolvePayers` does the conversion at read time, apportioning the *stored*
 * `baseAmountMinor` by those weights, so the payer side sums to the same base
 * total the consumer side is split from. See ADR-0010.
 */

/** memberId -> amount in the expense's OWN currency. Sums to `amountMinor`. */
export type PayerSpec = Record<Id, number>;

/** The payer fields of an expense — everything these functions need, no more. */
export interface PayerBearing {
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

export interface PayerValidation {
  ok: boolean;
  /** What the payers currently add up to, in the expense's own currency. */
  allocatedMinor: number;
  totalMinor: number;
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
      return { ok: false, allocatedMinor: 0, totalMinor: amountMinor,
        message: `${id}'s contribution must be a whole number of minor units` };
    }
    if (v < 0) {
      return { ok: false, allocatedMinor: 0, totalMinor: amountMinor,
        message: "Nobody can pay a negative amount" };
    }
    sum += v;
  }
  if (sum === 0) {
    return { ok: false, allocatedMinor: 0, totalMinor: amountMinor,
      message: "Nobody has put anything in yet" };
  }
  if (sum !== amountMinor) {
    const diff = amountMinor - sum;
    return {
      ok: false, allocatedMinor: sum, totalMinor: amountMinor,
      message: diff > 0 ? `${diff} minor units still unaccounted for`
                        : `${-diff} minor units more than the expense`,
    };
  }
  return { ok: true, allocatedMinor: sum, totalMinor: amountMinor };
}

/**
 * What each payer put in, in the group's BASE currency, summing exactly to
 * `baseAmountMinor`.
 *
 * With no `payers`, that is the whole amount to `paidBy` — identical to what
 * the app did before co-sponsoring existed. With `payers`, the base total is
 * apportioned by the stored contributions using the same seeded
 * largest-remainder distribution as a shares split, so the payer side and the
 * consumer side can never disagree by a cent. Seeded with the expense id and a
 * `:payers` suffix so the leftover minor unit doesn't always land on the same
 * side of the same expense.
 *
 * A spec that doesn't sum to `amountMinor` is not rejected here: balances must
 * never fail to render because somebody's editor wrote a bad row. The weights
 * are used as given and the base total still comes out exact.
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

/** Convenience for a full `Expense`, which always has the fields above. */
export function payersOf(expense: Expense): Record<Id, number> {
  return resolvePayers(expense);
}
