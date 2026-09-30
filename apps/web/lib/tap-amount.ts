/**
 * What tapping a person's row does in a column of amounts — the split editor's
 * "as amounts" and `/g/payers`. The two gestures a column wants most, with no
 * button for either:
 *
 * - a row holding a figure goes to **zero**;
 * - a row at zero takes **what is left** of the total;
 * - a row at zero with nothing left to take (the column is already full, or
 *   over) **edits** its field instead — the tap has no figure it could mean.
 *
 * Amounts are minor units, always positive (docs/data-model.md#money).
 */
export type AmountTap = { set: number } | "edit";

export function tapAmount(
  amounts: Readonly<Record<string, number | undefined>>,
  memberId: string,
  totalMinor: number,
): AmountTap {
  if ((amounts[memberId] ?? 0) > 0) return { set: 0 };
  const others = Object.entries(amounts)
    .filter(([id]) => id !== memberId)
    .reduce((sum, [, v]) => sum + (v ?? 0), 0);
  const rest = totalMinor - others;
  return rest > 0 ? { set: rest } : "edit";
}

/** The row's accessible name: what this tap would do, in that screen's words. */
export function tapLabel(tap: AmountTap, name: string, words: {
  clear: (name: string) => string;
  giveRest: (name: string) => string;
  edit: (name: string) => string;
}): string {
  if (tap === "edit") return words.edit(name);
  return tap.set === 0 ? words.clear(name) : words.giveRest(name);
}
