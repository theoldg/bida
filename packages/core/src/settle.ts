import type { Id } from "./types.js";

/**
 * Reduce a set of balances to the fewest payments that clear everyone.
 *
 * Two passes, and the first is what makes the count minimal. The minimum number
 * of transfers is `n − p`, where `p` is the largest number of disjoint groups
 * the members can be cut into that each sum to zero: money never has to cross
 * between two such groups, and inside one that cannot be cut further every
 * payment can clear at most one person, so `size − 1` is both the floor and the
 * ceiling. So: find the best cut (`partition`), then settle each piece
 * (`fill`). Finding the cut is the NP-hard part — `partition` is a subset DP,
 * exact but exponential, so above `EXACT_LIMIT` people we skip it and settle
 * the group as one piece, which is the old behaviour and no longer minimal.
 *
 * `fill` decides *who pays whom*, which the count alone leaves open: smallest
 * debtor first, into the smallest creditor who can absorb the whole debt. Owing
 * a little means one transfer; only a debt too big for any single creditor is
 * split. This never costs a transfer — every piece takes exactly `size − 1`
 * however it is filled — so it is free to be kind about it.
 *
 * "Simplest way to settle" is still the honest UI wording for a group past
 * `EXACT_LIMIT`; "fewest possible" is true below it.
 */

export interface Transfer {
  from: Id;
  to: Id;
  amountMinor: number;
}

interface Party {
  id: Id;
  amount: number;
}

/**
 * Above this many members holding a non-zero balance, skip the exact pass.
 * The DP walks the zero-sum subsets, so cost is worst when many members hold
 * the same amount: 16 costs ~10ms there, 18 costs ~100ms, 20 over a second.
 * A bill-splitting group this size is already unusual, and it still settles —
 * just not provably in the fewest transfers.
 */
const EXACT_LIMIT = 16;

export function settleUp(balances: Record<Id, number>): Transfer[] {
  // Sorted by id so the mask indices below — and so the answer — are the same
  // on every device, whatever order the record was built in.
  const people: Party[] = Object.entries(balances)
    .filter(([, balance]) => balance !== 0)
    .map(([id, balance]) => ({ id, amount: balance }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (people.length === 0) return [];

  const pieces = people.length <= EXACT_LIMIT ? partition(people) : [people];
  // Smallest debt first across pieces too, so the whole list reads the way each
  // piece does.
  pieces.sort((a, b) => smallestDebt(a) - smallestDebt(b) || (a[0]!.id < b[0]!.id ? -1 : 1));
  return pieces.flatMap(fill);
}

function smallestDebt(piece: readonly Party[]): number {
  return Math.min(...piece.filter((p) => p.amount < 0).map((p) => -p.amount));
}

/**
 * Cut the members into as many zero-sum groups as possible.
 *
 * `parts[m]` is the most groups the members in bitmask `m` can be cut into, and
 * `take[m]` the group peeled off to get there — enough to rebuild the cut.
 * Only zero-sum masks can be cut at all, so the walk skips the rest.
 */
function partition(people: readonly Party[]): Party[][] {
  const n = people.length;
  const full = (1 << n) - 1;

  // Float64 because a group's total can pass 2^31 minor units, and every
  // integer below 2^53 is exact in a double.
  const sum = new Float64Array(1 << n);
  for (let m = 1; m <= full; m++) {
    const low = m & -m;
    sum[m] = sum[m ^ low]! + people[31 - Math.clz32(low)]!.amount;
  }

  const parts = new Int8Array(1 << n).fill(-1);
  const take = new Int32Array(1 << n);
  parts[0] = 0;
  for (let m = 1; m <= full; m++) {
    if (sum[m]! !== 0) continue;
    // Every subset is tried once, as the piece holding `m`'s lowest member.
    const low = m & -m;
    for (let s = m; s > 0; s = (s - 1) & m) {
      if ((s & low) === 0 || sum[s]! !== 0) continue;
      const rest = parts[m ^ s]!;
      if (rest >= 0 && rest + 1 > parts[m]!) {
        parts[m] = rest + 1;
        take[m] = s;
      }
    }
  }

  // Balances that don't sum to zero have no cut at all. They shouldn't reach
  // here (`core/balance.ts` asserts it), but settling something beats throwing.
  if (parts[full]! < 0) return [[...people]];

  const pieces: Party[][] = [];
  for (let m = full; m > 0; m ^= take[m]!) {
    const piece = take[m]!;
    pieces.push(people.filter((_, i) => (piece >> i) & 1));
  }
  return pieces;
}

/** Settle one zero-sum piece. Always `piece.length − 1` transfers. */
function fill(piece: readonly Party[]): Transfer[] {
  const debtors: Party[] = [];
  const creditors: Party[] = [];
  for (const { id, amount } of piece) {
    if (amount < 0) debtors.push({ id, amount: -amount });
    else creditors.push({ id, amount });
  }

  // Smallest first, ties by member id: deterministic on every device.
  const bySize = (a: Party, b: Party) => a.amount - b.amount || (a.id < b.id ? -1 : 1);
  debtors.sort(bySize);
  creditors.sort(bySize);

  const transfers: Transfer[] = [];
  for (const debtor of debtors) {
    while (debtor.amount > 0) {
      // Best fit: the smallest creditor who can take the rest in one payment,
      // so the large creditors stay whole for the debts that need them. If
      // nobody can, empty the largest creditor and go round again.
      const creditor = creditors.find((c) => c.amount >= debtor.amount) ?? largest(creditors);
      if (!creditor) break;
      const amount = Math.min(debtor.amount, creditor.amount);
      transfers.push({ from: debtor.id, to: creditor.id, amountMinor: amount });
      debtor.amount -= amount;
      creditor.amount -= amount;
    }
  }
  return transfers;
}

function largest(creditors: readonly Party[]): Party | undefined {
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
