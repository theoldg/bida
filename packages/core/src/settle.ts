import type { Id } from "./types.js";

/**
 * Reduce a set of balances to a small set of payments that clears everyone.
 *
 * This is greedy largest-debtor against largest-creditor. It yields at most
 * n−1 transfers, which is good but not provably minimal — genuinely minimising
 * the count is NP-hard. Say "the simplest way to settle" in the UI, never
 * "optimal", because occasionally it isn't.
 */

export interface Transfer {
  from: Id;
  to: Id;
  amountMinor: number;
}

export function settleUp(balances: Record<Id, number>): Transfer[] {
  const debtors: { id: Id; amount: number }[] = [];
  const creditors: { id: Id; amount: number }[] = [];

  for (const [id, balance] of Object.entries(balances)) {
    if (balance < 0) debtors.push({ id, amount: -balance });
    else if (balance > 0) creditors.push({ id, amount: balance });
  }

  // Deterministic on every device: biggest first, ties by member id.
  const bySize = (a: { id: Id; amount: number }, b: { id: Id; amount: number }) =>
    b.amount - a.amount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  debtors.sort(bySize);
  creditors.sort(bySize);

  const transfers: Transfer[] = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d]!;
    const creditor = creditors[c]!;
    const amount = Math.min(debtor.amount, creditor.amount);
    if (amount > 0) {
      transfers.push({ from: debtor.id, to: creditor.id, amountMinor: amount });
      debtor.amount -= amount;
      creditor.amount -= amount;
    }
    if (debtor.amount === 0) d += 1;
    if (creditor.amount === 0) c += 1;
  }

  return transfers;
}

/** Only the payments involving one member — what personal mode shows. */
export function transfersFor(transfers: readonly Transfer[], memberId: Id): Transfer[] {
  return transfers.filter((t) => t.from === memberId || t.to === memberId);
}

/** Applying every transfer must leave everyone at zero. Used in tests and dev. */
export function applyTransfers(
  balances: Record<Id, number>,
  transfers: readonly Transfer[],
): Record<Id, number> {
  const out = { ...balances };
  for (const t of transfers) {
    out[t.from] = (out[t.from] ?? 0) + t.amountMinor;
    out[t.to] = (out[t.to] ?? 0) - t.amountMinor;
  }
  return out;
}
