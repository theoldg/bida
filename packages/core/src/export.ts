import { minorToDecimalString } from "./money.js";
import { resolvePayers } from "./payers.js";
import { resolveSplit } from "./split.js";
import { alive, type Expense, type GroupState, type Id, type Settlement } from "./types.js";

/**
 * A group as Splitwise's CSV export — the one shape every other splitter
 * (Tricount included) imports: `Date,Description,Category,Cost,Currency` then a
 * column per member.
 *
 * **A member's cell is `paid − owed`**, so rows sum to zero and column totals
 * are balances. Figures come from `resolvePayers`/`resolveSplit` under
 * `computeBalances`'s seeds, so the `Total balance` foot equals `byMember` to
 * the cent. Everything is in base currency: the caller reprices first
 * (`atCurrentRates`, ADR-0005).
 */

/**
 * Protocol tokens, not copy: importers match `Payment` literally, skip
 * `Total balance` and fall back to `General`. Never translate them.
 */
const PAYMENT = "Payment";
const GENERAL = "General";
const TOTAL_BALANCE = "Total balance";

interface CsvOptions {
  /**
   * A timestamp as the *local* `YYYY-MM-DD` — only the app knows the timezone.
   * Pass `apps/web/lib/format.ts`'s `dateInputValue`.
   */
  formatDay: (ts: number) => string;
  /** The foot's `Date` cell, which Splitwise fills with the export day. */
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
 * The member columns: the group, then anyone removed who is still on a live
 * entry (or totals stop summing to zero). Headers are the plain name —
 * "Bruno (removed)" would import as a new person. Sorted by name then id; two
 * members may share a name and so a header.
 */
export function exportColumns(state: GroupState): ExportColumn[] {
  const byName = (a: ExportColumn, b: ExportColumn) =>
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

  const here = alive(state.members)
    .map((m): ExportColumn => ({ id: m.id, name: m.name, departed: false }))
    .sort(byName);
  const present = new Set(here.map((c) => c.id));

  // Asked of the same functions that write the figures, so no figure lands in
  // a missing column.
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

/** The group as one CSV, oldest first, as a spreadsheet is read. */
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
    // Blank lines under the header and above the foot, as Splitwise writes.
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

  // Every foot cell matters to importers: the export day in `Date`, the words in
  // `Description`, a space for category and cost.
  lines.push("");
  lines.push(row([
    formatDay(exportedAt), TOTAL_BALANCE, " ", " ", currency,
    ...columns.map((c) => money(totals[c.id] ?? 0)),
  ]));

  // LF, a trailing blank line, no BOM — as Splitwise emits. Tricount takes
  // nothing with CRLF.
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
    // Unapportionable (also in `computeBalances`' `problems`). Kept with every
    // column zero: dropping it loses money, and apportioning only the payers
    // breaks the zero sum and the foot.
    shares = undefined;
  }

  if (shares) {
    // The same loops as `computeBalances`, with an income read backwards.
    for (const [id, amount] of Object.entries(resolvePayers(e))) move(id, income ? -amount : amount);
    for (const [id, amount] of Object.entries(shares)) move(id, income ? amount : -amount);
  }

  return {
    when: e.occurredAt,
    created: e.createdAt ?? e.occurredAt,
    date: formatDay(e.occurredAt),
    description: e.description,
    category: e.categoryId || GENERAL,
    // The sign is the only way this format can say "income".
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
 * A cell escaped per RFC 4180: quoted when it holds a comma or quote, quotes
 * doubled. A newline folds to a space: readers splitting on LF first would see
 * a record break.
 */
function cell(value: string): string {
  const flat = value.replace(/[\r\n]+/g, " ");
  return /[",]/.test(flat) ? `"${flat.replace(/"/g, '""')}"` : flat;
}
