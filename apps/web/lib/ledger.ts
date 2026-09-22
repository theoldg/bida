import type { Expense, Settlement } from "@bida/core";
import { byWhen } from "./format";

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
