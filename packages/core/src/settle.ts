import type { Id } from "./types.js";

/**
 * Reduce a set of balances to the fewest payments that clear everyone.
 *
 * The minimum is `n − p`, where `p` is the largest number of disjoint zero-sum
 * pieces the group cuts into. Finding that cut is NP-hard — it contains
 * subset-sum — so `partition` leans on three cuts that make it affordable:
 *
 * 1. **Cancel exact opposites** first. Two people the search never sees, and
 *    it is the common case: one person's share of one dinner.
 * 2. **Search over amounts, not people.** Two members owing the same are
 *    interchangeable, so the state is *how many* hold each amount. An evenly
 *    split trip collapses from millions of subsets to a handful of states.
 * 3. **Stop at the first zero.** Extending a piece that already sums to zero
 *    can only merge two pieces into one, which never wins.
 *
 * What survives all three is a group of ~18+ with no two balances alike, which
 * is also the shape with the least to gain. There `partition` spends a fixed
 * budget, then `peel`s off what triples and quadruples it can find and settles
 * the rest as one piece: still `≤ n−1`, no longer provably fewest. So the UI
 * says "simplest way to settle" and not "optimal".
 *
 * `fill` then decides who pays whom, which the count alone leaves open:
 * smallest debtor first, into the smallest creditor who can absorb the whole
 * debt. Every piece costs `size − 1` however it is filled, so this is free.
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

/** Steps of search before `partition` gives up on being exact. The ceiling
 *  costs about 2ms; only a group of ~18+ with no two balances alike reaches it. */
const SEARCH_BUDGET = 50_000;

class OutOfBudget extends Error {}

export function settleUp(balances: Record<Id, number>): Transfer[] {
  // Sorted by id so the answer is the same on every device, whatever order the
  // record was built in.
  const people: Party[] = Object.entries(balances)
    .filter(([, balance]) => balance !== 0)
    .map(([id, balance]) => ({ id, amount: balance }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (people.length === 0) return [];

  const pieces = partition(people);
  // Smallest debt first across pieces too, so the whole list reads the way each
  // piece does.
  pieces.sort((a, b) => smallestDebt(a) - smallestDebt(b) || (a[0]!.id < b[0]!.id ? -1 : 1));
  return pieces.flatMap(fill);
}

function smallestDebt(piece: readonly Party[]): number {
  return Math.min(...piece.filter((p) => p.amount < 0).map((p) => -p.amount));
}

/** Cut the members into as many zero-sum pieces as possible. See the header. */
function partition(people: readonly Party[]): Party[][] {
  // People holding the same amount, in id order: the search moves counts
  // between these queues, and taking from the front keeps it deterministic.
  const holders = new Map<number, Party[]>();
  for (const person of people) {
    const queue = holders.get(person.amount);
    if (queue) queue.push(person);
    else holders.set(person.amount, [person]);
  }

  const pieces: Party[][] = [];

  // (1) Exact opposites, paired off and set aside.
  for (const amount of [...holders.keys()].sort((a, b) => a - b)) {
    if (amount <= 0) continue;
    const owed = holders.get(amount)!;
    const owing = holders.get(-amount);
    while (owing && owed.length > 0 && owing.length > 0) {
      pieces.push([owed.shift()!, owing.shift()!]);
    }
  }

  const amounts = [...holders.keys()].filter((a) => holders.get(a)!.length > 0).sort((a, b) => a - b);
  const counts = amounts.map((a) => holders.get(a)!.length);
  const take = (chosen: readonly number[]) =>
    pieces.push(amounts.flatMap((a, i) => holders.get(a)!.splice(0, chosen[i]!)));

  if (counts.some((c) => c > 0)) {
    try {
      // (2) + (3): search the counts, then replay the cut onto the people.
      const memo = new Map<string, { best: number; cut: number[] | null }>();
      const work = { steps: 0 };
      search(amounts, counts, memo, work);
      for (let state = counts; state.some((c) => c > 0); ) {
        const cut = memo.get(state.join(","))!.cut;
        if (!cut) break;
        take(cut);
        state = state.map((c, i) => c - cut[i]!);
      }
    } catch (error) {
      if (!(error instanceof OutOfBudget)) throw error;
      for (const cut of peel(amounts, amounts.map((a) => holders.get(a)!.length))) take(cut);
    }
    // Whatever the search or the fallback left over is one last piece.
    const rest = amounts.flatMap((a) => holders.get(a)!.splice(0));
    if (rest.length > 0) pieces.push(rest);
  }

  return pieces;
}

/**
 * The most zero-sum pieces the remaining counts cut into, memoised per state.
 * Records the piece it took first, so the caller can replay the cut.
 */
function search(
  amounts: readonly number[],
  counts: readonly number[],
  memo: Map<string, { best: number; cut: number[] | null }>,
  work: { steps: number },
): number {
  if (counts.every((c) => c === 0)) return 0;
  const key = counts.join(",");
  const seen = memo.get(key);
  if (seen) return seen.best;
  if (++work.steps > SEARCH_BUDGET) throw new OutOfBudget();

  const entry = { best: 1, cut: null as number[] | null }; // worst case: all one piece
  memo.set(key, entry);

  const size = counts.reduce((a, b) => a + b, 0);
  // Exact opposites are gone, so no piece is smaller than three.
  const ceiling = Math.max(1, Math.floor(size / 3));
  const chosen = counts.map(() => 0);
  const first = counts.findIndex((c) => c > 0);

  const walk = (i: number, total: number, picked: number) => {
    if (entry.best >= ceiling) return; // cannot do better; stop looking
    if (total === 0 && picked > 0) {
      const got = 1 + search(amounts, counts.map((c, j) => c - chosen[j]!), memo, work);
      if (got > entry.best) {
        entry.best = got;
        entry.cut = [...chosen];
      }
      return; // a piece already — extending it could only merge two into one
    }
    if (i >= counts.length) return;
    if (++work.steps > SEARCH_BUDGET) throw new OutOfBudget();
    // Can what is left still bring the running total back to zero?
    let low = total;
    let high = total;
    for (let j = i; j < counts.length; j++) {
      const swing = amounts[j]! * (counts[j]! - chosen[j]!);
      if (swing < 0) low += swing;
      else high += swing;
    }
    if (low > 0 || high < 0) return;
    for (let more = counts[i]! - chosen[i]!; more >= 0; more--) {
      chosen[i] = chosen[i]! + more;
      walk(i + 1, total + amounts[i]! * more, picked + more);
      chosen[i] = chosen[i]! - more;
    }
  };

  // Anchor on one holder of the first amount — every piece contains one, and
  // fixing it means no piece is enumerated twice. Carry on at the same index:
  // a piece may hold several people owing that same amount.
  chosen[first] = 1;
  walk(first, amounts[first]!, 1);
  chosen[first] = 0;
  return entry.best;
}

/**
 * Out of budget: take the zero-sum triples and quadruples that a table of pair
 * sums can find, and leave the rest. Cheap, and better than giving up whole.
 */
function peel(amounts: readonly number[], counts: readonly number[]): number[][] {
  const items: number[] = [];
  for (const [i, count] of counts.entries()) for (let k = 0; k < count; k++) items.push(i);
  const cuts: number[][] = [];

  for (;;) {
    const pairs = new Map<number, [number, number]>();
    for (let a = 0; a < items.length; a++) {
      for (let b = a + 1; b < items.length; b++) {
        const sum = amounts[items[a]!]! + amounts[items[b]!]!;
        if (!pairs.has(sum)) pairs.set(sum, [a, b]);
      }
    }

    let hit: number[] | undefined;
    for (let a = 0; a < items.length && !hit; a++) {
      const pair = pairs.get(-amounts[items[a]!]!);
      if (pair && pair[0] !== a && pair[1] !== a) hit = [a, ...pair];
    }
    if (!hit) {
      for (const [sum, pair] of pairs) {
        const other = pairs.get(-sum);
        if (other && !other.some((x) => pair.includes(x))) {
          hit = [...pair, ...other];
          break;
        }
      }
    }
    if (!hit) return cuts;

    const cut = counts.map(() => 0);
    for (const at of hit) cut[items[at]!] = cut[items[at]!]! + 1;
    cuts.push(cut);
    const drop = new Set(hit);
    for (let i = items.length - 1; i >= 0; i--) if (drop.has(i)) items.splice(i, 1);
  }
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
