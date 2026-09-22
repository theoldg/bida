import type { Expense, Settlement } from "@bida/core";

/**
 * The three things a person can add to a group. Two share an entity
 * underneath, so this vocabulary is the only place the distinction shows.
 *
 * - **Expense** — money went out, shared by the people it was spent on.
 * - **Income** — money came in, shared by the people it belongs to. An
 *   `Expense` with `kind: "income"`; the sign lives in `computeBalances`.
 * - **Transfer** — money moved between two people. A `Settlement`.
 *   "Reimbursement" is not a kind, only the title settle-up prefills
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

/**
 * How one entry moves *your* balance: what you put in minus what you owe,
 * signed, in base minor units — the same subtraction for all three kinds
 * ([standing-instructions](../../../docs/standing-instructions.md#product)).
 */
export function myEffect(
  me: string | undefined,
  entry:
    | { kind: "expense" | "income"; putIn: number; share: number }
    | { kind: "transfer"; settlement: Settlement },
): number {
  if (!me) return 0;
  if (entry.kind === "transfer") {
    // Handing money over moves your balance up by exactly what you gave;
    // being paid moves it down. Same subtraction, one side each.
    const s = entry.settlement;
    return me === s.fromMember ? s.baseAmountMinor
      : me === s.toMember ? -s.baseAmountMinor : 0;
  }
  // An income runs backwards: you are down by what you took in and up by
  // your share of it.
  const sign = entry.kind === "income" ? -1 : 1;
  return sign * (entry.putIn - entry.share);
}
