// Doc: docs/receipt-scanning.md#typing-a-bill-in
import { minorToDecimalString, parseMinor, type ReceiptItem } from "@bida/core";
import { billLabel, MAX_PORTIONS, printedBill, unfoldAll } from "./items";

/**
 * One printed line as the hand editor holds it. Both prices are text, so a
 * half-typed figure is never snapped; `by` says which of the two was typed,
 * and the other is worked out from it.
 */
export interface ItemRow {
  key: string;
  label: string;
  /**
   * The line's two names as it opened, and which of them the field showed.
   * Kept only while the field still says `shown`: a typed name is the only one.
   */
  was: { label: string; labelEn: string | null; shown: string } | null;
  count: number;
  unitText: string;
  totalText: string;
  by: "unit" | "total";
  /** The printed line this row was opened from, so its eaters can follow it. */
  from: number | null;
}

let next = 0;
const key = () => `r${next++}`;

export function blankRow(): ItemRow {
  return {
    key: key(), label: "", was: null, count: 1,
    unitText: "", totalText: "", by: "total", from: null,
  };
}

function minorOrNull(text: string, currency: string): number | null {
  if (text.trim() === "") return null;
  try { return parseMinor(text, currency); } catch { return null; }
}

function textOf(minor: number | null, currency: string): string {
  return minor === null ? "" : minorToDecimalString(minor, currency);
}

/** What the whole line comes to, in minor units, or null while it has no price. */
export function rowMinor(row: ItemRow, currency: string): number | null {
  if (row.by === "total") return minorOrNull(row.totalText, currency);
  const unit = minorOrNull(row.unitText, currency);
  return unit === null ? null : unit * row.count;
}

/**
 * The figure nobody typed. A total typed over a count it doesn't divide shows
 * its unit rounded; the line is still worth exactly the total.
 */
function derived(row: ItemRow, currency: string): ItemRow {
  if (row.by === "unit") {
    return { ...row, totalText: textOf(rowMinor(row, currency), currency) };
  }
  const total = minorOrNull(row.totalText, currency);
  return { ...row, unitText: textOf(total === null ? null : Math.round(total / row.count), currency) };
}

export function setUnit(row: ItemRow, text: string, currency: string): ItemRow {
  return derived({ ...row, unitText: text, by: "unit" }, currency);
}

export function setTotal(row: ItemRow, text: string, currency: string): ItemRow {
  return derived({ ...row, totalText: text, by: "total" }, currency);
}

/**
 * "One more" is one more at the same price: from a single item the price is a
 * unit price, and only a total typed beside its count holds still.
 */
export function setCount(row: ItemRow, count: number, currency: string): ItemRow {
  const clamped = Math.min(MAX_PORTIONS, Math.max(1, Math.floor(count) || 1));
  const single = row.count === 1 && row.by === "total" ? { by: "unit" as const, unitText: row.totalText } : {};
  return derived({ ...row, ...single, count: clamped }, currency);
}

/** A row with nothing typed in it is not a line, and is dropped rather than refused. */
export function rowIsEmpty(row: ItemRow): boolean {
  return row.label.trim() === "" && row.unitText.trim() === "" && row.totalText.trim() === "";
}

/** A row that would be saved wrong: a name and no price, or a price of nothing. */
export function rowIsBad(row: ItemRow, currency: string): boolean {
  if (rowIsEmpty(row)) return false;
  const minor = rowMinor(row, currency);
  return minor === null || minor <= 0 || row.label.trim() === "";
}

/** The other name, while the field still says the one it opened on. */
export function otherName(row: ItemRow): string | null {
  const was = row.was;
  if (!was || row.label.trim() !== was.shown) return null;
  const other = was.shown === was.label ? was.labelEn : was.label;
  return other && other !== was.shown ? other : null;
}

/**
 * The draft's bill, folded back into the lines it was printed as, each named
 * in the language the bill is read in.
 */
export function rowsFromBill(items: readonly ReceiptItem[], currency: string, english: boolean): ItemRow[] {
  const { lines } = printedBill(items, null, currency);
  return lines.map((line, i) => {
    const count = Math.max(1, Math.round(line.quantity));
    const minor = minorOrNull(line.amount, currency);
    // A line that divides is a price per item, as the bill meant it; one that
    // doesn't keeps its total, which is the figure the bill actually printed.
    const even = minor !== null && minor % count === 0;
    const shown = billLabel(line, english);
    return derived({
      key: key(),
      label: shown,
      was: { label: line.label, labelEn: line.labelEn, shown },
      count,
      unitText: even ? textOf(minor / count, currency) : "",
      totalText: line.amount,
      by: even ? "unit" : "total",
      from: i,
    }, currency);
  });
}

/**
 * The rows as the draft keeps a bill: unfolded into portions, with whoever had
 * a line still having it if the line kept its count — renaming a dish or
 * fixing its price is no reason to tick it again.
 */
export function billFromRows(
  rows: readonly ItemRow[],
  before: { items: readonly ReceiptItem[]; assignments: readonly (readonly string[])[] | null },
  currency: string,
): { items: ReceiptItem[]; assignments: string[][] | null; totalMinor: number } {
  const kept = rows.filter((row) => !rowIsEmpty(row) && !rowIsBad(row, currency));
  const printed: ReceiptItem[] = kept.map((row) => {
    const label = row.label.trim();
    const kept = row.was && label === row.was.shown ? row.was : null;
    return {
      label: kept ? kept.label : label,
      labelEn: kept ? kept.labelEn : null,
      amount: minorToDecimalString(rowMinor(row, currency)!, currency),
      quantity: row.count > 1 ? row.count : null,
      portionOf: null,
    };
  });
  const { items, from } = unfoldAll(printed, currency);
  const totalMinor = kept.reduce((sum, row) => sum + rowMinor(row, currency)!, 0);

  if (!before.assignments) return { items, assignments: null, totalMinor };
  const { eaters } = printedBill(before.items, before.assignments, currency);
  const firstOf = new Map<number, number>();
  const assignments = items.map((_, k) => {
    const row = kept[from[k]!]!;
    const start = firstOf.get(from[k]!) ?? k;
    firstOf.set(from[k]!, start);
    const was = row.from === null ? undefined : eaters[row.from];
    if (!was) return [];
    // One set of eaters for the whole line follows it whatever its count;
    // a portion each only while the portions are the same ones.
    if (was.length === 1) return [...was[0]!];
    return was.length === countOf(from, from[k]!) ? [...was[k - start]!] : [];
  });
  return { items, assignments, totalMinor };
}

function countOf(from: readonly number[], line: number): number {
  return from.filter((f) => f === line).length;
}
