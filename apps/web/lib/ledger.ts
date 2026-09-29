import type { Expense, Settlement } from "@bida/core";
import { byWhen } from "./format";
import type { LedgerItem } from "./ledger-motion";

/**
 * The ledger's two tables as one list, in the order a person reads them.
 *
 * Each table arrives sorted (`useGroupData`), but merged they need one
 * comparator over both — and merged is what the screen draws.
 */

/**
 * One row. `row` names the table, not the kind — an income is `row:
 * "expense"`; the kind is on the expense (`kindOf`).
 *
 * **A row carries the stored entry and nothing copied off it** — copied
 * fields miss the next one the order depends on (as `dateOnly` would),
 * silently mis-sorting the ledger.
 */
export type LedgerRow =
  | { row: "expense"; expense: Expense }
  | { row: "settlement"; settlement: Settlement };

/** The stored entry behind a row. */
export function entryOf(row: LedgerRow): Expense | Settlement {
  return row.row === "expense" ? row.expense : row.settlement;
}

export function ledgerRows(expenses: Expense[], settlements: Settlement[]): LedgerRow[] {
  return [
    ...expenses.map((expense): LedgerRow => ({ row: "expense", expense })),
    ...settlements.map((settlement): LedgerRow => ({ row: "settlement", settlement })),
  ].sort((a, b) => byWhen(entryOf(a), entryOf(b)));
}

/**
 * The ledger as it is drawn: its rows, each day's run headed by a date line.
 * A date line is its own item rather than riding on the day's first row, so
 * it stays put while a row above it in the same day comes or goes, and folds
 * on its own when the last one does. Keyed by the calendar day, not the
 * label, which renames itself at midnight ("Today" → "Yesterday").
 */
export function ledgerItems(
  expenses: Expense[], settlements: Settlement[], label: (ts: number) => string,
): LedgerItem<LedgerRow>[] {
  const out: LedgerItem<LedgerRow>[] = [];
  let last = "";
  for (const row of ledgerRows(expenses, settlements)) {
    const at = entryOf(row).occurredAt;
    const day = label(at);
    if (day !== last) {
      const d = new Date(at);
      out.push({ key: `day:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, kind: "day", label: day });
      last = day;
    }
    out.push({ key: entryOf(row).id, kind: "row", row });
  }
  return out;
}
