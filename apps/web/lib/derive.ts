// Doc: docs/live-reads.md#a-save-moves-a-few-entries
import {
  atCurrentRates, currenciesInUse, emptyGroupState, retallyBalances, settleUp, stateFromRows,
  tallyBalances, wouldViolate,
  type BalanceReport, type BalanceTally, type CurrencyInUse, type ExchangeRate, type Expense,
  type Group, type GroupState, type Member, type OpDraft, type RegisteredInvariant,
  type Settlement, type Transfer,
} from "@bida/core";
import { copy } from "./copy";
import { mark } from "./diag";
import { byWhen, sortedByWhen } from "./format";

/**
 * A group's read, worked out into what its screens draw — derived money is
 * computed here from the rows, never stored. Pure: `lib/hooks.ts` reads, this
 * adds up.
 */

/** What `groupRows` (lib/hooks.ts) reads: every row in the table's own order, by id. */
export interface GroupRows {
  group: Group | undefined;
  members: Member[];
  expenses: Expense[];
  settlements: Settlement[];
  rates: ExchangeRate[];
  pending: number;
}

export interface GroupData {
  group: Group | undefined;
  members: Member[];
  /** Removed ones included: the name matters most exactly when they've left. */
  memberById: Map<string, Member>;
  nameOf: (id: string) => string;
  hasLeft: (id: string) => boolean;
  expenses: Expense[];
  settlements: Settlement[];
  /** The old rate registry: a fallback for `latestRate`. */
  rates: Record<string, ExchangeRate>;
  currencies: CurrencyInUse[];
  balances: BalanceReport;
  transfers: Transfer[];
  me: string | undefined;
  /**
   * **The only source of a refusal in the app** — a screen deciding for itself is
   * the drift docs/invariants.md is about. `healGroup` makes the state legal when
   * it loses.
   */
  guard: (draft: OpDraft) => RegisteredInvariant | undefined;
  /** For the deleted entry's screen; everything else reads the live arrays. */
  withTombstones: GroupState;
  /** Every entry, deleted ones included — history's, whose subject may be gone. */
  expenseById: Map<string, Expense>;
  settlementById: Map<string, Settlement>;
  pendingOps: number;
  loading: boolean;
}

export type Derived = Omit<GroupData, "me" | "loading">;

/** What one answer gave, kept to move from when the next arrives. */
interface Kept {
  rows: GroupRows;
  out: Derived;
  tally: BalanceTally;
}

/**
 * By the rows read, not per screen: every screen of a group is handed the same
 * answer (lib/db/live.ts keeps it the same object), so the balances are worked
 * out once rather than again on every screen opened.
 */
const derived = new WeakMap<GroupRows, Derived>();
/** Per group, the answer last worked out. */
const last = new Map<string, Kept>();

/**
 * Past this many entries moved, adding them all up again is as quick and
 * simpler to trust: a pull of a long trip, an import.
 */
const MOST_MOVED = 50;

export function derive(rows: GroupRows): Derived {
  const known = derived.get(rows);
  if (known) return known;
  const id = rows.group?.id;
  const before = id === undefined ? undefined : last.get(id);
  const moved = before && fromLast(before, rows);
  const kept = moved ?? whole(rows);
  derived.set(rows, kept.out);
  if (id !== undefined) last.set(id, kept);
  if (moved && checking()) crossCheck(rows, moved.out);
  return kept.out;
}

function living<T extends { deletedAt?: number | null }>(rows: readonly T[]): T[] {
  return rows.filter((r) => !r.deletedAt);
}

/** Every entry added up from nothing. */
function whole(rows: GroupRows): Kept {
  const members = living(rows.members).sort((a, b) => a.name.localeCompare(b.name));
  // Stable over rows in id order, so ties fall by id — what `insert` keeps.
  const sortedExpenses = sortedByWhen(living(rows.expenses));
  const sortedSettlements = sortedByWhen(living(rows.settlements));
  // Detection needs the tombstones: a removed member on a live entry is the
  // point.
  const withTombstones = stateFromRows(rows);
  // Each entry valued at the rate it is read at, here and nowhere else: one
  // screen reading the stored `baseAmountMinor` is how screens disagree
  // (ADR-0005). Tombstones and all, as balances and currencies read the living
  // alone: a second state cost a 10,000-entry group a tenth of a second.
  const state = atCurrentRates({
    ...withTombstones, rates: Object.fromEntries(living(rows.rates).map((r) => [r.id, r])),
  });
  // The state keys them and loses the sort.
  const bySortOrder = <T extends { id: string }>(rows: T[], keyed: Record<string, T>) =>
    rows.map((row) => keyed[row.id] ?? row);
  const tally = tallyBalances(state);
  const memberById = new Map(rows.members.map((m) => [m.id, m]));
  const out: Derived = {
    group: rows.group,
    members,
    memberById,
    nameOf: (id) => memberById.get(id)?.name ?? copy.unknown,
    hasLeft: (id) => !!memberById.get(id)?.deletedAt,
    expenses: bySortOrder(sortedExpenses, state.expenses),
    settlements: bySortOrder(sortedSettlements, state.settlements),
    rates: state.rates,
    currencies: currenciesInUse(state),
    balances: tally.report,
    transfers: settleUp(tally.report.byMember),
    guard: (draft) => wouldViolate(withTombstones, draft),
    withTombstones,
    expenseById: new Map(Object.entries(withTombstones.expenses)),
    settlementById: new Map(Object.entries(withTombstones.settlements)),
    pendingOps: rows.pending,
  };
  return { rows, out, tally };
}

/**
 * The stamp on a row (lib/db/fold.ts): it moves whenever the row's ops do. A
 * row written before there were stamps has none, and counts as moved.
 */
function revOf(row: object): string | undefined {
  return (row as { rev?: string }).rev;
}

/** The same rows, by id and stamp: none of them moved. */
function sameRows(a: readonly object[], b: readonly object[]): boolean {
  if (a === b) return true;
  return a.length === b.length && a.every((row, i) => {
    const rev = revOf(row);
    return rev !== undefined && rev === revOf(b[i]!) && (row as { id: string }).id === (b[i] as { id: string }).id;
  });
}

type Entry = Expense | Settlement;

/** The rows whose stamp moved: what they were, and what they are. */
function changes<T extends Entry>(was: readonly T[], now: readonly T[]): { gone: T[]; come: T[] } | undefined {
  if (was === now) return { gone: [], come: [] };
  const byId = new Map<string, T>();
  for (const row of was) byId.set(row.id, row);
  const gone: T[] = [];
  const come: T[] = [];
  for (const row of now) {
    const before = byId.get(row.id);
    if (before !== undefined) {
      byId.delete(row.id);
      const rev = revOf(row);
      if (rev !== undefined && rev === revOf(before)) continue;
      gone.push(before);
    }
    come.push(row);
    if (come.length > MOST_MOVED) return undefined;
  }
  // Only leaving the group takes rows away, but a row that went is a change.
  for (const before of byId.values()) gone.push(before);
  return gone.length > MOST_MOVED ? undefined : { gone, come };
}

/**
 * The last answer moved by the entries that changed since, or undefined when
 * that isn't the cheap way: the group's row, a member or a rate changed (each
 * reaches every entry), or too many entries did.
 */
function fromLast(before: Kept, rows: GroupRows): Kept | undefined {
  const was = before.rows;
  if (!rows.group || !was.group || !sameRows([was.group], [rows.group])
    || !sameRows(was.members, rows.members) || !sameRows(was.rates, rows.rates)) return undefined;
  const ex = changes(was.expenses, rows.expenses);
  const st = changes(was.settlements, rows.settlements);
  if (!ex || !st || ex.come.length + st.come.length > MOST_MOVED) return undefined;
  const prev = before.out;

  // Valued as `whole` values them: the rates haven't moved, so a version that
  // went is priced as it was when it was counted.
  const price = (expenses: Expense[], settlements: Settlement[]) => atCurrentRates({
    ...emptyGroupState(), group: rows.group, rates: prev.rates,
    expenses: Object.fromEntries(expenses.map((e) => [e.id, e])),
    settlements: Object.fromEntries(settlements.map((s) => [s.id, s])),
  });
  const gone = price(ex.gone, st.gone);
  const come = price(ex.come, st.come);
  const tally = retallyBalances(before.tally,
    [...Object.values(gone.expenses), ...Object.values(gone.settlements)],
    [...Object.values(come.expenses), ...Object.values(come.settlements)]);

  const withTombstones: GroupState = {
    ...prev.withTombstones,
    expenses: patchRecord(prev.withTombstones.expenses, ex),
    settlements: patchRecord(prev.withTombstones.settlements, st),
  };
  const base = rows.group.baseCurrency;
  const foreign = (e: Entry) => e.currency !== base;
  const recount = [ex.gone, ex.come, st.gone, st.come].some((list) => list.some(foreign));
  const out: Derived = {
    ...prev,
    expenses: insert(prev.expenses, ex.gone, Object.values(come.expenses)),
    settlements: insert(prev.settlements, st.gone, Object.values(come.settlements)),
    currencies: recount ? currenciesInUse(withTombstones) : prev.currencies,
    balances: tally.report,
    transfers: settleUp(tally.report.byMember),
    guard: (draft) => wouldViolate(withTombstones, draft),
    withTombstones,
    expenseById: patchMap(prev.expenseById, ex),
    settlementById: patchMap(prev.settlementById, st),
    pendingOps: rows.pending,
  };
  return { rows, out, tally };
}

/** `byWhen`, ties by id: the order `whole`'s stable sort leaves them in. */
function order(a: Entry, b: Entry): number {
  return byWhen(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** A sorted list without what went, and with what came put in its place. */
function insert<T extends Entry>(list: T[], gone: readonly T[], come: readonly T[]): T[] {
  if (gone.length === 0 && come.length === 0) return list;
  const drop = new Set(gone.map((r) => r.id));
  const out = drop.size > 0 ? list.filter((r) => !drop.has(r.id)) : list.slice();
  for (const row of come) {
    if (row.deletedAt) continue;
    let lo = 0;
    let hi = out.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (order(out[mid]!, row) < 0) lo = mid + 1;
      else hi = mid;
    }
    out.splice(lo, 0, row);
  }
  return out;
}

function patchRecord<T extends Entry>(
  record: Record<string, T>, { gone, come }: { gone: readonly T[]; come: readonly T[] },
): Record<string, T> {
  if (gone.length === 0 && come.length === 0) return record;
  const out = { ...record };
  for (const row of gone) delete out[row.id];
  for (const row of come) out[row.id] = row;
  return out;
}

function patchMap<T extends Entry>(
  map: Map<string, T>, { gone, come }: { gone: readonly T[]; come: readonly T[] },
): Map<string, T> {
  if (gone.length === 0 && come.length === 0) return map;
  const out = new Map(map);
  for (const row of gone) out.delete(row.id);
  for (const row of come) out.set(row.id, row);
  return out;
}

/**
 * On the dev Worker (and `next dev`), every answer moved rather than added up
 * is added up again when the phone is idle, and any difference is a `/diag`
 * line: this is money, and the test can only try the cases it thought of.
 */
function checking(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.env === "dev" || process.env.NODE_ENV !== "production";
}

function crossCheck(rows: GroupRows, moved: Derived): void {
  const idle = globalThis.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 200));
  idle(() => {
    const differ = differences(moved, whole(rows).out);
    if (differ.length > 0) mark("derive.mismatch", differ.join(" "));
  });
}

/** Where two answers for the same rows disagree; empty when they don't. For the dev check and the tests. */
export function differences(a: Derived, b: Derived): string[] {
  const out: string[] = [];
  const sameRecord = (x: Record<string, unknown>, y: Record<string, unknown>) =>
    Object.keys(x).length === Object.keys(y).length && Object.keys(x).every((k) => Object.is(x[k], y[k]));
  const ra = a.balances;
  const rb = b.balances;
  for (const t of ["byMember", "paidMinor", "owedMinor", "receivedMinor", "incomeShareMinor", "settledMinor"] as const) {
    if (!sameRecord(ra[t], rb[t])) out.push(t);
  }
  if (ra.totalSpendMinor !== rb.totalSpendMinor) out.push("totalSpendMinor");
  if (ra.totalIncomeMinor !== rb.totalIncomeMinor) out.push("totalIncomeMinor");
  if (JSON.stringify(ra.problems) !== JSON.stringify(rb.problems)) out.push("problems");
  if (JSON.stringify(a.transfers) !== JSON.stringify(b.transfers)) out.push("transfers");
  if (JSON.stringify(a.currencies) !== JSON.stringify(b.currencies)) out.push("currencies");
  const listed = (list: readonly Entry[]) => list.map((e) => `${e.id}:${e.baseAmountMinor}`).join(",");
  if (listed(a.expenses) !== listed(b.expenses)) out.push("expenses");
  if (listed(a.settlements) !== listed(b.settlements)) out.push("settlements");
  const kept = (record: Record<string, Entry>) => Object.keys(record).sort().map((id) => `${id}:${revOf(record[id]!)}`).join(",");
  if (kept(a.withTombstones.expenses) !== kept(b.withTombstones.expenses)) out.push("tombstones");
  if (kept(a.withTombstones.settlements) !== kept(b.withTombstones.settlements)) out.push("tombstones");
  if (a.expenseById.size !== b.expenseById.size || a.settlementById.size !== b.settlementById.size) out.push("byId");
  return out;
}

export const testing = {
  /** Every entry added up from nothing, whatever was kept. */
  whole: (rows: GroupRows): Derived => whole(rows).out,
  /** Forget every answer, as a fresh page would. */
  forget: (): void => last.clear(),
  MOST_MOVED,
};
