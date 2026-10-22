// Doc: docs/receipt-scanning.md#typing-a-bill-in
import { minorToDecimalString, parseMinor, type BillExtras, type ReceiptExtra, type ReceiptItem } from "@bida/core";
import { billLabel, hasTranslation, MAX_PORTIONS, printedBill, unfoldAll } from "./items";

/**
 * What a line does to the money: an item is had by somebody; a discount and a
 * charge are nobody's, and come off or go on in proportion (ADR-0016).
 */
export type LineKind = "item" | "discount" | "charge";

/**
 * One printed line as the hand editor holds it. Both prices are text, so a
 * half-typed figure is never snapped; `by` says which of the two was typed,
 * and the other is worked out from it.
 */
export interface ItemRow {
  key: string;
  kind: LineKind;
  label: string;
  /**
   * The line's two names as it opened, and which of them the field shows.
   * Kept only while the field still says `shown`: a typed name is the only one.
   */
  was: { label: string; labelEn: string | null; shown: string } | null;
  /** An item's alone; kept through a change of kind, so changing back loses nothing. */
  count: number;
  unitText: string;
  totalText: string;
  by: "unit" | "total";
  /** The printed item this row was opened from, so its eaters can follow it. */
  from: number | null;
}

let next = 0;
const key = () => `r${next++}`;

export function blankRow(): ItemRow {
  return {
    key: key(), kind: "item", label: "", was: null, count: 1,
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

/**
 * A new item goes after the last item, not under the discounts and charges:
 * the bill keeps its items first, so that is where it would reopen.
 */
export function withItemAdded(rows: readonly ItemRow[], row: ItemRow): ItemRow[] {
  const at = rows.map((r) => r.kind).lastIndexOf("item") + 1;
  return [...rows.slice(0, at), row, ...rows.slice(at)];
}

/** The tip as the bill keeps it: settled, and none for a figure of nothing or one that can't be read. */
export function keptTip(text: string, currency: string): string | null {
  const minor = minorOrNull(text, currency);
  return minor === null || minor <= 0 ? null : minorToDecimalString(minor, currency);
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

/** A name still as the line opened, which keeps both of the line's names. */
function untouched(row: ItemRow): boolean {
  return !!row.was && row.label.trim() === row.was.shown;
}

/** The names a row is saved under: both while untouched, otherwise the one typed. */
export function namesOf(row: ItemRow): { label: string; labelEn: string | null } {
  return row.was && untouched(row)
    ? { label: row.was.label, labelEn: row.was.labelEn }
    : { label: row.label.trim(), labelEn: null };
}

/** Whether any row still has a second name to be read in. */
export function rowsTranslate(rows: readonly ItemRow[]): boolean {
  return hasTranslation(rows.flatMap((row) => (row.was && untouched(row) ? [row.was] : [])));
}

/**
 * The rows read the other way: an untouched name becomes the line's other
 * name; a typed one is the line's only name, and stays.
 */
export function readIn(rows: readonly ItemRow[], english: boolean): ItemRow[] {
  return rows.map((row) => {
    if (!row.was || !untouched(row)) return row;
    const shown = billLabel(row.was, english) || row.was.shown;
    return { ...row, label: shown, was: { ...row.was, shown } };
  });
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
      kind: "item",
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

/** A discount or a charge: the lines nobody had. */
export type ExtraLineKind = Exclude<LineKind, "item">;

/**
 * The bill's discounts and charges, after its items. One the bill named
 * nothing — a charge kept as a tax before charges had names — opens as its
 * kind's `unnamed`, and stays unnamed unless that is retyped.
 */
export function rowsFromExtras(
  extras: Pick<BillExtras, "charges" | "discounts">,
  english: boolean,
  unnamed: Record<ExtraLineKind, string>,
): ItemRow[] {
  const rows = (kind: ExtraLineKind, lines: readonly ReceiptExtra[]) => lines.map((line): ItemRow => {
    const shown = billLabel(line, english) || unnamed[kind];
    return {
      key: key(), kind, label: shown,
      was: { label: line.label, labelEn: line.labelEn ?? null, shown },
      count: 1, unitText: line.amount, totalText: line.amount, by: "total", from: null,
    };
  });
  return [...rows("discount", extras.discounts), ...rows("charge", extras.charges)];
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
): {
  items: ReceiptItem[];
  assignments: string[][] | null;
  totalMinor: number;
  discounts: ReceiptExtra[];
  charges: ReceiptExtra[];
} {
  const lines = rows.filter((row) => !rowIsEmpty(row) && !rowIsBad(row, currency));
  const line = (row: ItemRow): ReceiptExtra => (
    { ...namesOf(row), amount: minorToDecimalString(rowMinor(row, currency)!, currency) }
  );
  const extras = (kind: LineKind) => lines.filter((row) => row.kind === kind).map(line);
  const discounts = extras("discount");
  const charges = extras("charge");
  const kept = lines.filter((row) => row.kind === "item");
  const printed: ReceiptItem[] = kept.map((row) => (
    { ...line(row), quantity: row.count > 1 ? row.count : null, portionOf: null }
  ));
  const { items, from } = unfoldAll(printed, currency);
  const totalMinor = kept.reduce((sum, row) => sum + rowMinor(row, currency)!, 0);

  if (!before.assignments) return { items, assignments: null, totalMinor, discounts, charges };
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
  return { items, assignments, totalMinor, discounts, charges };
}

function countOf(from: readonly number[], line: number): number {
  return from.filter((f) => f === line).length;
}
