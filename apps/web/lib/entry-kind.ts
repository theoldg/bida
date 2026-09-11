import type { Expense, Settlement } from "@bida/core";

/**
 * The three things a person can add to a group, and every word the app uses
 * about them. One file, because the ledger row, the form's kind chip,
 * the detail screen and the history feed all have to call them the same
 * things — and because two of the three are the same entity underneath, so
 * the vocabulary is the only place the distinction is visible at all.
 *
 * - **Expense** — money went out, shared between the people it was spent on.
 * - **Income** — money came in, shared between the people it belongs to. An
 *   `Expense` with `kind: "income"`; the sign lives in `computeBalances`.
 * - **Transfer** — money moved from one person to another and the group is no
 *   poorer for it. A `Settlement`. Paying somebody back is *a* transfer, not a
 *   separate idea, which is why "reimbursement" appears nowhere any more.
 *
 * What they are *called* — the kind chip and its picker, the verb in "Marie
 * paid", the headings over the payer and the split — is `copy.entryKind`
 * (lib/copy.ts), like every other word the app says.
 *
 * ADR-0010.
 */
export type EntryKind = "expense" | "income" | "transfer";

export const ENTRY_KINDS: readonly EntryKind[] = ["expense", "income", "transfer"];

/** An expense row's kind. Absent means expense, forever — see `Expense.kind`. */
export function kindOf(expense: Expense): "expense" | "income" {
  return expense.kind === "income" ? "income" : "expense";
}

/**
 * How one entry moves *your* balance: what you put in for it minus what you
 * owe for it, signed, in base minor units. The ledger's whole job
 * ([standing-instructions](../../../docs/standing-instructions.md#product)),
 * and it is the same subtraction for all three kinds — which is why it lives
 * here rather than three times over.
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
