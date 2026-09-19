import { minorToDecimalString } from "./money.js";
import { resolvePayers } from "./payers.js";
import { resolveSplit } from "./split.js";
import { alive, type Expense, type GroupState, type Id, type Settlement } from "./types.js";

/**
 * A group as the CSV every other splitter can read.
 *
 * The one interoperable shape is **Splitwise's export**:
 * `Date,Description,Category,Cost,Currency` then a column per member. Even
 * Tricount's importer takes that and not its own format, so this is what gets
 * a group into Tricount, Splitwise, Sesterce, Spliit and a spreadsheet.
 *
 * **A member's column is `paid − owed` for that row**, signed, so every row
 * sums to zero and the column totals are the balances. Not a second opinion
 * about the arithmetic: the payer map and split come from `resolvePayers` and
 * `resolveSplit` under the seeds `computeBalances` uses, so the `Total
 * balance` foot is `byMember` to the cent. If they disagree, this file is wrong.
 *
 * **Everything is in the group's base currency.** The shape has one `Currency`
 * per row and nowhere to say a row is in MAD while the balance below is in
 * euros, so the caller hands over a state already repriced at the registry
 * (`atCurrentRates`). ADR-0005.
 */

/**
 * The three cells the format dictates, not the app — protocol tokens, so they
 * live here and not in `copy.ts` (ADR-0033 covers what a person reads on a
 * screen). An importer matches `Payment` literally, skips the `Total balance`
 * row, and falls back to `General`. Never translate them.
 */
const PAYMENT = "Payment";
const GENERAL = "General";
const TOTAL_BALANCE = "Total balance";

interface CsvOptions {
  /**
   * A timestamp as `YYYY-MM-DD`. An argument for the reason core takes its
   * clock as one: the honest answer is the *local* day — an expense added at
   * 23:00 must not export as tomorrow — and only the app knows the timezone.
   * Pass `apps/web/lib/format.ts`'s `dateInputValue`, which the form shows.
   */
  formatDay: (ts: number) => string;
  /**
   * When the file is being written — the foot's `Date` cell, which a real
   * Splitwise export fills with the export day rather than leaving empty.
   */
  exportedAt: number;
}

/** One member column: who it is, and whether they are still in the group. */
interface ExportColumn {
  id: Id;
  name: string;
  /** Removed, but still named by a live entry — so still carrying a balance. */
  departed: boolean;
}

/**
 * Whose columns the file has, left to right: the group, then anybody removed
 * who is still on a live entry. A departed member needs a column or the totals
 * stop summing to zero. Their header is the plain name with nothing appended —
 * an importer matches on it, so "Bruno (removed)" imports as a fourth person.
 *
 * Sorted by name then id, never by object order, which is a fold's accident.
 * Two members really can share a name, and then the file has two identical
 * headers; the alternative corrupts the cell an importer reads.
 */
export function exportColumns(state: GroupState): ExportColumn[] {
  const byName = (a: ExportColumn, b: ExportColumn) =>
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

  const here = alive(state.members)
    .map((m): ExportColumn => ({ id: m.id, name: m.name, departed: false }))
    .sort(byName);
  const present = new Set(here.map((c) => c.id));

  // Whoever a row moves money for, asked of the same two functions that write
  // the figures — the only way no figure lands in a column that isn't there.
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
 * The group as one CSV, oldest row first — chronological, unlike every screen
 * in the app, because that is what a spreadsheet is read top-down for.
 */
export function groupToCsv(state: GroupState, { formatDay, exportedAt }: CsvOptions): string {
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
    // A blank line under the header and another above the foot: a real
    // Splitwise export has both.
    "",
  ];

  const totals: Record<Id, number> = {};
  for (const r of rows) {
    for (const c of columns) {
      const delta = r.deltas[c.id] ?? 0;
      totals[c.id] = (totals[c.id] ?? 0) + delta;
    }
    lines.push(row([
      r.date, r.description, r.category, money(r.costMinor), currency,
      ...columns.map((c) => money(r.deltas[c.id] ?? 0)),
    ]));
  }

  // The foot is a summary, not an expense, and every cell is load-bearing:
  // the export day in `Date` (an importer parses it), the words in
  // `Description` (it aborts the file on them), a space for category and cost.
  // There is nowhere here to put a total spend figure.
  lines.push("");
  lines.push(row([
    formatDay(exportedAt), TOTAL_BALANCE, " ", " ", currency,
    ...columns.map((c) => money(totals[c.id] ?? 0)),
  ]));

  // LF and a trailing blank line, and no BOM — what Splitwise emits, checked
  // against an export Tricount accepts. CRLF here and Tricount takes nothing.
  return `${lines.map((line) => `${line}\n`).join("")}\n`;
}

function expenseRow(e: Expense, formatDay: (ts: number) => string): Row {
  const income = e.kind === "income";
  const deltas: Record<Id, number> = {};
  const move = (id: Id, amount: number) => { deltas[id] = (deltas[id] ?? 0) + amount; };

  let shares: Record<Id, number> | undefined;
  try {
    shares = resolveSplit(e.baseAmountMinor, e.split, { tiebreakSeed: e.id }).shares;
  } catch {
    // An expense `computeBalances` could not apportion either, so it is in
    // that report's `problems`. Kept with every column zero: dropping it loses
    // money somebody typed, and apportioning the payers alone leaves a row
    // that doesn't sum to zero and a foot that no longer matches `byMember`.
    shares = undefined;
  }

  if (shares) {
    // The same two loops `computeBalances` runs, with the sign it applies: an
    // income is an expense read backwards (ADR-0010).
    for (const [id, amount] of Object.entries(resolvePayers(e))) move(id, income ? -amount : amount);
    for (const [id, amount] of Object.entries(shares)) move(id, income ? amount : -amount);
  }

  return {
    when: e.occurredAt,
    created: e.createdAt ?? e.occurredAt,
    date: formatDay(e.occurredAt),
    description: e.description,
    category: e.categoryId || GENERAL,
    // One amount column, and nothing in the format says "income" — so the
    // sign is all that can. An importer refusing a negative refuses the row
    // rather than silently booking a cost.
    costMinor: income ? -e.baseAmountMinor : e.baseAmountMinor,
    deltas,
  };
}

function transferRow(s: Settlement, formatDay: (ts: number) => string): Row {
  return {
    when: s.occurredAt,
    created: s.createdAt ?? s.occurredAt,
    date: formatDay(s.occurredAt),
    // With no note, the cell an importer keys on.
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
 * A cell, escaped as RFC 4180 has it: quoted when it holds a comma or a quote,
 * inner quotes doubled. Descriptions are free text, so `Dinner, wine and "the
 * good cheese"` must stay one cell.
 *
 * A newline is the exception and folds to a space. RFC 4180 allows one inside
 * a quoted cell, but a reader that splits on LF before parsing quotes sees a
 * record break — and two in a row look like the blank line ending the file.
 */
function cell(value: string): string {
  const flat = value.replace(/[\r\n]+/g, " ");
  return /[",]/.test(flat) ? `"${flat.replace(/"/g, '""')}"` : flat;
}
