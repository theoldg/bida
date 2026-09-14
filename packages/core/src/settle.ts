import type { Id } from "./types.js";

/**
 * Reduce a set of balances to a small set of payments that clears everyone.
 *
 * Smallest debtor first, each paid into the smallest creditor who can absorb
 * the whole debt. That keeps the burden where the debt is: someone who owes a
 * little makes one transfer, and only a debtor too big for any single creditor
 * is split across several. The alternative — greedy biggest against biggest —
 * ends up handing the fragments to whoever is left, which is often the person
 * who owes least.
 *
 * Still at most n−1 transfers, and still not provably minimal: genuinely
 * minimising the count is NP-hard. Say "the simplest way to settle" in the UI,
 * never "optimal", because occasionally it isn't.
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

  // Deterministic on every device: smallest first, ties by member id.
  const bySize = (a: { id: Id; amount: number }, b: { id: Id; amount: number }) =>
    a.amount - b.amount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  debtors.sort(bySize);
  creditors.sort(bySize);

  const transfers: Transfer[] = [];
  for (const debtor of debtors) {
    while (debtor.amount > 0) {
      // The smallest creditor who can take the rest in one payment — best fit,
      // so the large creditors stay whole for the debtors that need them. If
      // nobody can, empty the largest creditor and go round again.
      const fits = creditors.find((c) => c.amount >= debtor.amount);
      const creditor = fits ?? lastNonEmpty(creditors);
      if (!creditor) break; // balances don't sum to zero; nothing left to pay into
      const amount = Math.min(debtor.amount, creditor.amount);
      transfers.push({ from: debtor.id, to: creditor.id, amountMinor: amount });
      debtor.amount -= amount;
      creditor.amount -= amount;
    }
  }

  return transfers;
}

function lastNonEmpty(creditors: readonly { id: Id; amount: number }[]) {
  for (let i = creditors.length - 1; i >= 0; i--) {
    if (creditors[i]!.amount > 0) return creditors[i]!;
  }
  return undefined;
}

/** Only the payments involving one member — what a member's own view shows. */
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
