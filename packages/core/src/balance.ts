// Doc: docs/data-model.md#balances-and-settle-up
import { resolvePayers } from "./payers";
import { resolveEntrySplit } from "./split";
import { alive, emptyGroupState, type Expense, type GroupState, type Id, type Settlement } from "./types";

/**
 * Balances are derived on read, never stored: paid − owed, in base minor
 * units; positive means the group owes you. They always sum to zero, or
 * something upstream is broken.
 *
 * The one place that knows an **income** runs backwards: the receiver is down
 * by it, the sharers up by their share. Nothing else in core branches on
 * `Expense.kind` (ADR-0010).
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
   * Per member: sent minus received in transfers — without it `paidMinor` and
   * `owedMinor` can't reach `byMember`.
   */
  settledMinor: Record<Id, number>;
  /** Entries we could not apportion. Rendered as a warning, never swallowed. */
  problems: { expenseId: Id; reason: string }[];
}

export function computeBalances(state: GroupState): BalanceReport {
  return tallyBalances(state).report;
}

/**
 * `computeBalances` kept open, so a few entries can be taken back out and put
 * in again (`retallyBalances`) instead of every entry summed afresh — a save in
 * a 10,000-entry group moves one.
 */
export interface BalanceTally {
  readonly report: BalanceReport;
  /**
   * Per member, how many things name them: one for being a live member, one
   * per payer or share of a live entry. At zero they leave every table, as a
   * full sum would never have listed them.
   */
  readonly names: Readonly<Record<Id, number>>;
}

export function tallyBalances(state: GroupState): BalanceTally {
  const sums = open(undefined);
  for (const m of alive(state.members)) name(sums, m.id, 1);
  for (const e of alive(state.expenses)) count(sums, e, 1);
  for (const s of alive(state.settlements)) count(sums, s, 1);
  return close(sums);
}

/**
 * The tally with `gone` taken out and `come` put in — exactly what
 * `tallyBalances` gives the state they lead to, in integers, so nothing drifts
 * however many saves it carries. `gone` are the versions this tally counted,
 * valued as they were; deleted ones on either side count for nothing, as in a
 * full sum. The members must be the ones it was tallied with: they are not in
 * the delta.
 */
export function retallyBalances(
  tally: BalanceTally,
  gone: readonly (Expense | Settlement)[],
  come: readonly (Expense | Settlement)[],
): BalanceTally {
  const sums = open(tally);
  for (const entry of gone) if (!entry.deletedAt) count(sums, entry, -1);
  for (const entry of come) if (!entry.deletedAt) count(sums, entry, 1);
  return close(sums);
}

/** A tally being written: its own copies, so the one it came from stands. */
interface Sums {
  byMember: Record<Id, number>;
  paidMinor: Record<Id, number>;
  owedMinor: Record<Id, number>;
  receivedMinor: Record<Id, number>;
  incomeShareMinor: Record<Id, number>;
  settledMinor: Record<Id, number>;
  names: Record<Id, number>;
  problems: Map<Id, string>;
  totalSpendMinor: number;
  totalIncomeMinor: number;
}

function open(from: BalanceTally | undefined): Sums {
  const r = from?.report;
  return {
    byMember: { ...r?.byMember },
    paidMinor: { ...r?.paidMinor },
    owedMinor: { ...r?.owedMinor },
    receivedMinor: { ...r?.receivedMinor },
    incomeShareMinor: { ...r?.incomeShareMinor },
    settledMinor: { ...r?.settledMinor },
    names: { ...from?.names },
    problems: new Map(r?.problems.map((p) => [p.expenseId, p.reason])),
    totalSpendMinor: r?.totalSpendMinor ?? 0,
    totalIncomeMinor: r?.totalIncomeMinor ?? 0,
  };
}

/** By entry id, so the warning names the same one on every device and either way. */
function close(sums: Sums): BalanceTally {
  const { names, problems, ...report } = sums;
  return {
    report: {
      ...report,
      problems: [...problems].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([expenseId, reason]) => ({ expenseId, reason })),
    },
    names,
  };
}

const TABLES = ["byMember", "paidMinor", "owedMinor", "receivedMinor", "incomeShareMinor", "settledMinor"] as const;

/**
 * A member deleted after their expenses still has to appear, or the balances
 * stop summing to zero; one nothing names any more goes, exactly zero in every
 * table by then.
 */
function name(sums: Sums, id: Id, k: 1 | -1): void {
  const left = (sums.names[id] ?? 0) + k;
  if (left > 0) {
    sums.names[id] = left;
    for (const t of TABLES) sums[t][id] ??= 0;
    return;
  }
  delete sums.names[id];
  for (const t of TABLES) delete sums[t][id];
}

/**
 * One entry into the sums (`k` 1) or back out (`k` -1). Additions only, so no
 * -0; and on the way out a name is let go after the amounts, which it holds
 * the keys open for.
 */
function count(sums: Sums, entry: Expense | Settlement, k: 1 | -1): void {
  const named: Id[] = [];
  const add = (table: Record<Id, number>, id: Id, amount: number) => {
    table[id] = (table[id] ?? 0) + k * amount;
  };
  const touch = (id: Id) => {
    if (k > 0) name(sums, id, 1);
    else named.push(id);
  };

  if ("fromMember" in entry) {
    // A transfer moves money without being a cost: the payer's debt shrinks.
    touch(entry.fromMember);
    touch(entry.toMember);
    add(sums.byMember, entry.fromMember, entry.baseAmountMinor);
    add(sums.byMember, entry.toMember, -entry.baseAmountMinor);
    add(sums.settledMinor, entry.fromMember, entry.baseAmountMinor);
    add(sums.settledMinor, entry.toMember, -entry.baseAmountMinor);
  } else {
    let shares: Record<Id, number>;
    try {
      // Seeded with the expense id so leftover cents rotate between
      // members instead of always landing on the same person.
      shares = resolveEntrySplit(entry).shares;
    } catch (err) {
      if (k > 0) sums.problems.set(entry.id, err instanceof Error ? err.message : String(err));
      else sums.problems.delete(entry.id);
      return;
    }
    const income = entry.kind === "income";
    if (income) sums.totalIncomeMinor += k * entry.baseAmountMinor;
    else sums.totalSpendMinor += k * entry.baseAmountMinor;

    // On an income the payer map names who received, and runs the other way.
    const sign = income ? -1 : 1;
    const putIn = income ? sums.receivedMinor : sums.paidMinor;
    const share = income ? sums.incomeShareMinor : sums.owedMinor;
    for (const [id, amount] of Object.entries(resolvePayers(entry))) {
      touch(id);
      add(putIn, id, amount);
      add(sums.byMember, id, sign * amount);
    }
    for (const [id, amount] of Object.entries(shares)) {
      touch(id);
      add(share, id, amount);
      add(sums.byMember, id, -sign * amount);
    }
  }
  for (const id of named) name(sums, id, -1);
}

/** `computeBalances` run on one entry alone. */
function alone(entry: Expense | Settlement): BalanceReport {
  const state = emptyGroupState();
  if ("fromMember" in entry) state.settlements[entry.id] = entry;
  else state.expenses[entry.id] = entry;
  return computeBalances(state);
}

/**
 * How one entry moves one member's balance, so an income's sign is still
 * applied in `computeBalances` and nowhere else. `up` is what moved them up
 * (paid, or their cut of an income), `down` what moved them down (their share,
 * or an income they took in) — both positive, `net` their difference. A
 * transfer's legs are `net` alone.
 */
export function entryEffect(entry: Expense | Settlement, memberId: Id): { up: number; down: number; net: number } {
  const r = alone(entry);
  const at = (table: Record<Id, number>) => table[memberId] ?? 0;
  return {
    up: at(r.paidMinor) + at(r.incomeShareMinor),
    down: at(r.owedMinor) + at(r.receivedMinor),
    net: at(r.byMember),
  };
}

/**
 * Every member one entry moves, by how much — empty for one nothing can
 * apportion. The export's row, so its foot is `byMember` by construction.
 */
export function entryDeltas(entry: Expense | Settlement): Record<Id, number> {
  return alone(entry).byMember;
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
