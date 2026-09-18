import type { Expense, Settlement } from "@bida/core";
import { byWhen } from "./format";

/**
 * The ledger's two tables as one list, in the order a person reads them.
 *
 * Each table arrives sorted (`useGroupData`), but merged they need one
 * comparator over both — and merged is what the screen draws.
 */

/**
 * One row. `row` names the table it came from, not the entry's kind — an
 * income is a `row: "expense"` — because which of the three it is lives on the
 * expense itself (`kindOf`).
 *
 * A row carries the stored entry and nothing copied off it. It used to copy
 * out the two fields the order was decided by, and the day a third joined them
 * (`dateOnly`) the copy quietly stopped keeping up: every backdated receipt
 * sorted as though it had a time, on the one screen that matters. What places
 * a row in time is asked of the entry.
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
