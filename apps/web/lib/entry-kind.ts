// Doc: docs/data-model.md#the-three-kinds-of-entry
import type { Expense } from "@bida/core";

/**
 * The three things a person can add to a group. Two share an entity
 * underneath, so this vocabulary is the only place the distinction shows.
 *
 * - **Expense** — money went out, shared by the people it was spent on.
 * - **Income** — money came in, shared by the people it belongs to. An
 *   `Expense` with `kind: "income"`; the sign lives in `computeBalances`.
 * - **Transfer** — money moved between two people. A `Settlement`.
 *   "Reimbursement" is not a kind, only the note settle-up's Record writes
 *   (`copy.form.reimbursement`).
 *
 * The words are `copy.entryKind` (lib/copy.ts). ADR-0010.
 */
export type EntryKind = "expense" | "income" | "transfer";

export const ENTRY_KINDS: readonly EntryKind[] = ["expense", "income", "transfer"];

/** An expense row's kind. Absent means expense, forever — see `Expense.kind`. */
export function kindOf(expense: Expense): "expense" | "income" {
  return expense.kind === "income" ? "income" : "expense";
}
