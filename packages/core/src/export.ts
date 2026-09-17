import { minorToDecimalString } from "./money.js";
import { resolvePayers } from "./payers.js";
import { resolveSplit } from "./split.js";
import { alive, type Expense, type GroupState, type Id, type Settlement } from "./types.js";

/**
 * A group as the CSV every other splitter can read.
 *
 * There is exactly one interoperable shape and it is **Splitwise's export**:
 * `Date,Description,Category,Cost,Currency` followed by one column per member.
 * Tricount has no import of its own format — what it has is "import from
 * Splitwise" — so emitting Splitwise's columns is what gets a group into
 * Tricount, Splitwise, Sesterce, Spliit and a spreadsheet, and emitting
 * Tricount's own `Paid by X`/`Paid for X` shape would get it into nothing that
 * doesn't already take this one.
 *
 * **A member's column is `paid − owed` for that row**, signed, so every row
 * sums to zero and the column totals are the balances. That is not a second
 * opinion about the arithmetic: the payer map and the split come from
 * `resolvePayers` and `resolveSplit` under the same tiebreak seeds
 * `computeBalances` uses, so the `Total balance` row at the foot is
 * `byMember`, to the cent. If they ever disagree, this file is wrong.
 *
 * **Everything is in the group's base currency.** The shape has one `Currency`
 * per row and one set of member columns, with nowhere to say that a row's
 * figures are in MAD while the balance below them is in euros. So the caller
 * hands over a state already repriced at the registry (`atCurrentRates`) and
 * the column is constant — which is also the only way the foot of the file
 * agrees with the Balances tab (ADR-0005).
 */

/**
 * The three cells whose spelling the format dictates rather than the app.
 *
 * Not a violation of ADR-0033: `copy.ts` owns every word *a person reads on a
 * screen*, and these are protocol tokens. An importer matches `Payment`
 * literally to know the row moves money instead of spending it, skips the row
 * that says `Total balance`, and falls back to `General` for a category it has
 * no name for. Translating any of them would break the import that is the
 * whole reason this file exists.
 */
const PAYMENT = "Payment";
const GENERAL = "General";
const TOTAL_BALANCE = "Total balance";

export interface CsvOptions {
  /**
   * A timestamp as `YYYY-MM-DD`. Taken as an argument for the reason core
   * takes its clock as one: the honest answer is the *local* day — an expense
   * added at 23:00 must not export as tomorrow — and only the app knows the
   * timezone. `apps/web/lib/format.ts`'s `dateInputValue` is what the form
   * already shows, so passing it keeps one home for the fact.
   */
  formatDay: (ts: number) => string;
}

/** One member column: who it is, and whether they are still in the group. */
export interface ExportColumn {
  id: Id;
  name: string;
  /** Removed, but still named by a live entry — so still carrying a balance. */
  departed: boolean;
}

/**
 * Whose columns the file has, left to right: the group, then anybody removed
 * who is still on a live entry.
 *
 * A departed member has to get a column or the totals stop summing to zero —
 * the same reason `computeBalances` `touch()`es them and the balances tab
 * shows them marked. Their header is their plain name, with nothing appended:
 * the name is what an importer matches on, so "Bruno (removed)" would import
 * as a fourth person.
 *
 * Sorted by name, then by id — never by object order, which is a fold's
 * accident. Two members really can share a name (one written before
 * ADR-0034), and then the file has two identical headers; nothing can be done
 * about that without corrupting the cell an importer reads.
 */
export function exportColumns(state: GroupState): ExportColumn[] {
  const byName = (a: ExportColumn, b: ExportColumn) =>
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

  const here = alive(state.members)
    .map((m): ExportColumn => ({ id: m.id, name: m.name, departed: false }))
    .sort(byName);
  const present = new Set(here.map((c) => c.id));

  // Whoever a row actually moves money for — which is whoever `expenseRow`
  // and `transferRow` will write a figure against. Asking the same two
  // functions is what guarantees no figure lands in a column that isn't there.
  const named = new Set<Id>();
  for (const e of alive(state.expenses)) {
    for (const id of Object.keys(expenseRow(e, () => "").deltas)) named.add(id);
  }
  for (const s of alive(state.settlements)) {
    named.add(s.fromMember);
    named.add(s.toMember);
  }

  const gone = [...named]
    .filter((id) => !present.has(id))
    .map((id): ExportColumn => ({ id, name: state.members[id]?.name ?? id, departed: true }))
    .sort(byName);

  return [...here, ...gone];
}

/** One line of the file, before it is quoted and joined. */
interface Row {
  when: number;
  /** Entry order tiebreak, exactly as the ledger's own sort uses it. */
  created: number;
  date: string;
  description: string;
  category: string;
  /** Base-currency minor units. Negative on an income. */
  costMinor: number;
  /** memberId -> paid − owed, base-currency minor units. Sums to zero. */
  deltas: Record<Id, number>;
}

/**
 * The group as one CSV, oldest row first.
 *
 * Chronological, unlike every screen in the app: a ledger read top-down is
 * what a spreadsheet is for, and an importer does not care either way.
 */
export function groupToCsv(state: GroupState, { formatDay }: CsvOptions): string {
  const group = state.group;
  if (!group) throw new Error("groupToCsv: no group in this state");
  const currency = group.baseCurrency;
  const columns = exportColumns(state);

  const rows: Row[] = [];
  for (const e of alive(state.expenses)) rows.push(expenseRow(e, formatDay));
  for (const s of alive(state.settlements)) rows.push(transferRow(s, formatDay));
  rows.sort((a, b) => (a.when - b.when) || (a.created - b.created));

  const money = (minor: number) => minorToDecimalString(minor, currency);
  const lines: string[] = [
    row(["Date", "Description", "Category", "Cost", "Currency", ...columns.map((c) => c.name)]),
  ];

  const totals: Record<Id, number> = {};
  let totalCostMinor = 0;
  for (const r of rows) {
    totalCostMinor += r.costMinor;
    for (const c of columns) {
      const delta = r.deltas[c.id] ?? 0;
      totals[c.id] = (totals[c.id] ?? 0) + delta;
    }
    lines.push(row([
      r.date, r.description, r.category, money(r.costMinor), currency,
      ...columns.map((c) => money(r.deltas[c.id] ?? 0)),
    ]));
  }

  // The foot, which is a summary and not an expense. Importers know to skip
  // the row spelled `Total balance`; a spreadsheet does not, which is worth
  // knowing before you sum the Cost column.
  lines.push(row([
    TOTAL_BALANCE, "", "", money(totalCostMinor), currency,
    ...columns.map((c) => money(totals[c.id] ?? 0)),
  ]));

  // CRLF, as the CSV spec has it and as Splitwise emits it. No BOM: Excel
  // wants one to read accented names, and an importer matching `Date`
  // literally chokes on the one that precedes it — and the import is what
  // this file is for.
  return lines.map((line) => `${line}\r\n`).join("");
}

function expenseRow(e: Expense, formatDay: (ts: number) => string): Row {
  const income = e.kind === "income";
  const deltas: Record<Id, number> = {};
  const move = (id: Id, amount: number) => { deltas[id] = (deltas[id] ?? 0) + amount; };

  let shares: Record<Id, number> | undefined;
  try {
    shares = resolveSplit(e.baseAmountMinor, e.split, { tiebreakSeed: e.id }).shares;
  } catch {
    // An expense `computeBalances` could not apportion either — it is in that
    // report's `problems` and left out of the balances. The row is kept, with
    // every column zero: dropping it would lose money somebody typed, and
    // apportioning the payers alone would leave a row that doesn't sum to
    // zero and a foot that no longer matches `byMember`.
    shares = undefined;
  }

  if (shares) {
    // The same two loops `computeBalances` runs, with the sign it applies —
    // an income is an expense read backwards and this is the only other place
    // that knows it (ADR-0010).
    for (const [id, amount] of Object.entries(resolvePayers(e))) move(id, income ? -amount : amount);
    for (const [id, amount] of Object.entries(shares)) move(id, income ? amount : -amount);
  }

  return {
    when: e.occurredAt,
    created: e.createdAt ?? e.occurredAt,
    date: formatDay(e.occurredAt),
    description: e.description,
    category: e.categoryId || GENERAL,
    // Negative, because the shape has one amount column and an income runs the
    // other way through it. Nothing in the format says "income", so the sign
    // is the only thing that can: an importer that refuses a negative refuses
    // the row rather than silently booking a cost.
    costMinor: income ? -e.baseAmountMinor : e.baseAmountMinor,
    deltas,
  };
}

function transferRow(s: Settlement, formatDay: (ts: number) => string): Row {
  return {
    when: s.occurredAt,
    created: s.createdAt ?? s.occurredAt,
    date: formatDay(s.occurredAt),
    // The note is what a person wrote about it; with none, the row says what
    // it is, which is also the cell an importer keys on.
    description: s.note || PAYMENT,
    category: PAYMENT,
    costMinor: s.baseAmountMinor,
    deltas: { [s.fromMember]: s.baseAmountMinor, [s.toMember]: -s.baseAmountMinor },
  };
}

/** One record: cells quoted only where they have to be, comma-joined. */
function row(cells: string[]): string {
  return cells.map(cell).join(",");
}

/**
 * A cell, escaped the way RFC 4180 has it: wrapped in quotes when it holds a
 * comma, a quote or a newline, with inner quotes doubled.
 *
 * Descriptions are free text somebody typed on a phone, so all three turn up —
 * `Dinner, wine and "the good cheese"` is one cell, and a file that let it be
 * three is a file that imports as garbage.
 */
function cell(value: string): string {
  return /["\r\n,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
