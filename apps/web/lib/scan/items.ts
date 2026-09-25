import {
  extrasMinor, minorToDecimalString, parseMinor, resolveSplit,
  type BillExtras, type ExtraKind, type ReceiptItem, type SplitMode,
} from "@bida/core";

/** A line of the bill, and how much of it was one person's. */
export interface MemberLine {
  /** The bill's own label. Empty for an extra, which is nobody's order. */
  label: string;
  /** Which bill-level line this is, when it is one — charged for, but not ordered. */
  extra?: ExtraKind;
  /** How much of it was theirs — one, two, or a third of a shared plate. */
  count: Count;
  /** What that came to, in the receipt's own currency. */
  minor: number;
}

/** A count that can be a share of one: `n/d`, always in lowest terms. */
interface Count { n: number; d: number }

/** What a bill's line has to say for itself here. `ReceiptItem` satisfies it. */
interface BillLine { amount: string; label?: string; quantity?: number | null; portionOf?: number | null }

/** Anything the model read a label off: an item, or a deduction. */
interface Labelled { label: string; labelEn?: string | null }

/**
 * A line's label in the language the bill is being read in.
 *
 * **The original is the default**: the receipt in hand says those words, and a
 * silent "Tagine" → "Lamb stew" can't be checked against it. English is a
 * device-local toggle on the who-had-what bar, and reaches the saved copy of
 * the bill too. Falls back to the original where the model gave no English.
 */
export function billLabel(line: Labelled, english: boolean): string {
  return english ? line.labelEn || line.label : line.label;
}

/** The same lines, relabelled. The array itself is untouched when it isn't needed. */
export function billLabels<T extends Labelled>(lines: readonly T[], english: boolean): readonly T[] {
  return english ? lines.map((line) => ({ ...line, label: billLabel(line, true) })) : lines;
}

/** The extras, with every deduction's printed name relabelled the same way. */
export function billExtrasIn(extras: BillExtras, english: boolean): BillExtras {
  return english ? { ...extras, discounts: [...billLabels(extras.discounts, true)] } : extras;
}

/**
 * Whether anything reads differently in English, which decides whether the
 * toggle is drawn at all.
 */
export function hasTranslation<T extends Labelled>(
  ...lines: readonly (readonly T[] | null | undefined)[]
): boolean {
  return lines.some((set) => set?.some((line) => !!line.labelEn && line.labelEn !== line.label));
}

function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }

function count(n: number, d: number): Count {
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
}

function plus(a: Count, b: Count): Count { return count(a.n * b.d + b.n * a.d, a.d * b.d); }

/** One bill-level charge to spread: a tip, a tax, or one of the deductions. */
interface BillCharge { kind: ExtraKind; label: string; amount: string; seed: string }

/**
 * The extras as a flat list, as a bill rules them off: each deduction by name,
 * then tax, then tip. Deductions stay separate (they divide identically) so a
 * person's copy says "2 for 1 −4.44" rather than one opaque figure.
 */
export function billCharges(extras: BillExtras | null): BillCharge[] {
  if (!extras) return [];
  const off = extras.discounts.map((d, i) => (
    { kind: "discount" as const, label: d.label, amount: d.amount, seed: `discount${i}` }
  ));
  const on = ([["tax", extras.tax], ["tip", extras.tip]] as const).flatMap(([kind, amount]) =>
    amount ? [{ kind, label: "", amount, seed: kind }] : []);
  return [...off, ...on];
}

/**
 * Who had what, read two ways at once: as split weights, and as each person's
 * copy of the bill.
 *
 * Each item divides among the members checked for it (largest remainder, as a
 * real split), and the results are summed. The sum is only a *ratio* against
 * the converted total, so its currency doesn't matter.
 *
 * Tip, tax and discounts are nobody's order, so each is spread in proportion
 * to what people did order (ADR-0016) — the only division the grid can justify.
 *
 * The lines are that arithmetic kept rather than summed away, so they add up
 * to the weight by construction.
 */
export function receiptBreakdown(
  items: readonly BillLine[],
  assignments: readonly Set<string>[],
  extras: BillExtras | null,
  involved: ReadonlySet<string>,
  currency: string,
  seed: string,
): { weights: Record<string, number>; lines: Record<string, MemberLine[]> } {
  const weights: Record<string, number> = {};
  const lines: Record<string, MemberLine[]> = {};
  const add = (id: string, minor: number) => { weights[id] = (weights[id] ?? 0) + minor; };
  // One entry per label, not per row: two rows of the same thing, or a whole
  // one plus half of another, read as "×2" and "×1 1/2" rather than as a list
  // that says the same word twice.
  const note = (id: string, line: MemberLine) => {
    const own = lines[id] ??= [];
    const same = own.find((l) => l.label === line.label && l.extra === line.extra);
    if (!same) { own.push(line); return; }
    same.count = plus(same.count, line.count);
    same.minor += line.minor;
  };

  items.forEach((item, i) => {
    const who = [...(assignments[i] ?? new Set<string>())];
    if (who.length === 0) return;
    let minor = 0;
    try { minor = parseMinor(item.amount, currency); } catch { return; }
    if (minor <= 0) return;
    const { shares } = resolveSplit(minor, { mode: "equal", members: who }, { tiebreakSeed: `${seed}:item${i}` });
    // What the row is a row *of*: "Fries ×2" shared by two is one order of
    // fries each. A portion carries no count of its own — unfolding is what
    // turned the printed one into rows (`unfoldItem`).
    const of = !item.portionOf && item.quantity && item.quantity > 1 ? Math.floor(item.quantity) : 1;
    for (const [id, v] of Object.entries(shares)) {
      add(id, v);
      note(id, { label: item.label ?? "", count: count(of, who.length), minor: v });
    }
  });

  // What each person ordered, fixed before any extra is spread, so the extras
  // don't affect one another and their order can't matter.
  const ordered = { ...weights };
  for (const charge of billCharges(extras)) {
    if (involved.size === 0) continue;
    let minor = 0;
    try { minor = parseMinor(charge.amount, currency); } catch { continue; /* mid-type */ }
    if (minor <= 0) continue;
    // Proportional to what each ordered: the €40 steak tips more than the coffee.
    // With nothing assigned yet it falls back to even rather than dropping it.
    const proportional: Record<string, number> = {};
    for (const id of involved) if (ordered[id]) proportional[id] = ordered[id];
    const { shares } = Object.keys(proportional).length > 0
      ? resolveSplit(minor, { mode: "shares", weights: proportional }, { tiebreakSeed: `${seed}:${charge.seed}` })
      : resolveSplit(minor, { mode: "equal", members: [...involved] }, { tiebreakSeed: `${seed}:${charge.seed}` });
    // The one place a discount's sign is applied (`BillExtras`).
    const sign = charge.kind === "discount" ? -1 : 1;
    for (const [id, v] of Object.entries(shares)) {
      add(id, sign * v);
      note(id, { label: charge.label, extra: charge.kind, count: count(1, 1), minor: sign * v });
    }
  }

  // A discount worth more than the bill would owe somebody money, which an
  // expense cannot do. `checkScan` refuses such a receipt outright; this is
  // the floor under a bill typed into that state by hand.
  for (const [id, v] of Object.entries(weights)) if (v < 0) weights[id] = 0;

  // Zero-weight members are dropped, not kept at 0: "shares" mode reads
  // Object.keys() as the participant list, so a 0 would still owe nothing.
  for (const id of Object.keys(weights)) if (weights[id] === 0) delete weights[id];
  return { weights, lines };
}

/** The weights alone — what the split is derived from (ADR-0016). */
export function weightsFromItems(
  items: readonly BillLine[],
  assignments: Set<string>[],
  extras: BillExtras | null,
  involved: ReadonlySet<string>,
  currency: string,
  seed: string,
): Record<string, number> {
  return receiptBreakdown(items, assignments, extras, involved, currency, seed).weights;
}

/**
 * The receipt's own total — items plus tip and tax, less discounts — in its
 * currency. Receipt mode derives the amount from this, never typed, so it
 * matches what "who had what" adds up to. Null when there is nothing to sum,
 * so the caller leaves the amount alone rather than zeroing it.
 */
export function receiptTotalMinor(
  items: readonly { amount: string }[],
  extras: BillExtras | null,
  currency: string,
): number | null {
  let total = 0;
  let any = false;
  for (const item of items) {
    try { total += parseMinor(item.amount, currency); any = true; } catch { /* unreadable line, skip it */ }
  }
  // Null when a figure is mid-type and unreadable — worth nothing rather than
  // worth guessing at, the same as an unreadable line above.
  if (extras) total += extrasMinor(extras, currency) ?? 0;
  return any ? total : null;
}

/**
 * The amount to write into the draft when a tab change leaves Receipt mode,
 * or null to leave it alone.
 *
 * Receipt's total is derived at read time (ADR-0016), and a typed amount
 * lives only in `amountText` — so without this handoff (the amount half of
 * `convertSplitMode`) the amount reverts to whatever preceded the scan, often
 * nothing, and the expense is worth zero.
 *
 * **One-shot, at an explicit action, not a mirror**: only receipt →
 * arithmetic, so switching between arithmetic tabs never overwrites a typed
 * amount.
 */
export function handOffReceiptTotal(
  from: SplitMode,
  to: SplitMode,
  items: { amount: string }[] | null | undefined,
  extras: BillExtras | null,
  currency: string,
): string | null {
  if (from !== "receipt" || to === "receipt") return null;
  const total = receiptTotalMinor(items ?? [], extras, currency);
  // `minorToDecimalString`, not `bare`: what goes into `amountText` has to
  // be canonical text `parseMinor` can read back. `bare` groups thousands.
  return total === null ? null : minorToDecimalString(total, currency);
}

/**
 * Unfolding a printed line into separately assignable portions: "Salad ×2
 * 9.00" becomes two rows at half each, with their own eaters. Downstream
 * still sees weights and a bill that is the sum of its lines. ADR-0016.
 *
 * **Portions are marked (`portionOf`), never inferred from equal labels**, so
 * two identical printed lines aren't mistaken for one, and merging is exact.
 */

/** Where a row sits in an unfolded group: its start, its place, the size. */
interface Portion { start: number; index: number; of: number }

/**
 * One entry per item: null for an ordinary line, else its portion. A run
 * counts only when all `of` consecutive rows agree on label and count, so a
 * half-deleted group degrades to ordinary lines.
 */
export function portions(items: readonly ReceiptItem[]): (Portion | null)[] {
  const out: (Portion | null)[] = items.map(() => null);
  for (let i = 0; i < items.length; ) {
    const head = items[i];
    const of = head?.portionOf ?? 0;
    const run = head && of >= 2 && i + of <= items.length
      && items.slice(i, i + of).every((r) => r.portionOf === of && r.label === head.label);
    if (!run) { i++; continue; }
    for (let k = 0; k < of; k++) out[i + k] = { start: i, index: k + 1, of };
    i += of;
  }
  return out;
}

/** How many lines the bill printed: a run of portions is one of them. */
export function printedCount(items: readonly ReceiptItem[]): number {
  return portions(items).filter((p) => !p || p.index === 1).length;
}

/** The count a printed line can be unfolded into, or null if it can't be. */
export function unfoldableInto(item: ReceiptItem, currency: string): number | null {
  const count = item.quantity ?? 0;
  if (!Number.isInteger(count) || count < 2 || item.portionOf) return null;
  try { if (parseMinor(item.amount, currency) <= 0) return null; } catch { return null; }
  return count;
}

/**
 * Split `items[index]` into one row per printed unit, summing to the line
 * exactly (remainder to the earliest, a cent at a time), so the total and tip
 * percentage don't move. Returns the list and where it grew, so the caller
 * widens the assignment rows in step; null when not unfoldable.
 */
export function unfoldItem(
  items: readonly ReceiptItem[],
  index: number,
  currency: string,
): { items: ReceiptItem[]; at: number; count: number } | null {
  const item = items[index];
  if (!item) return null;
  const count = unfoldableInto(item, currency);
  if (count === null) return null;

  const minor = parseMinor(item.amount, currency);
  const each = Math.floor(minor / count);
  const remainder = minor - each * count;
  const parts: ReceiptItem[] = Array.from({ length: count }, (_, i) => ({
    label: item.label,
    labelEn: item.labelEn,
    amount: minorToDecimalString(each + (i < remainder ? 1 : 0), currency),
    // The printed count belongs to the line that's gone; a portion is one of.
    quantity: null,
    portionOf: count,
  }));
  return { items: [...items.slice(0, index), ...parts, ...items.slice(index + 1)], at: index, count };
}

/**
 * Every line that can be unfolded, unfolded — how a bill is kept from the
 * moment it arrives, so that folding a run on the grid is only ever a view and
 * never an edit to the bill. `from[i]` is the line row `i` came from, for
 * widening a grid's assignment rows in step.
 */
export function unfoldAll(
  items: readonly ReceiptItem[],
  currency: string,
): { items: ReceiptItem[]; from: number[] } {
  const out: ReceiptItem[] = [];
  const from: number[] = [];
  items.forEach((item, i) => {
    const parts = unfoldItem([item], 0, currency)?.items ?? [item];
    for (const part of parts) { out.push(part); from.push(i); }
  });
  return { items: out, from };
}

/**
 * The bill as printed: every run of portions read as its one line, and each
 * run's rows of eaters as one row where they all agree. What the history
 * compares, so splitting a line into portions — a change of shape, not of
 * the bill — never reads as "6 items → 7 items".
 */
export function printedBill(
  items: readonly ReceiptItem[],
  assignments: readonly (readonly string[])[] | null | undefined,
  currency: string,
): { lines: { label: string; labelEn: string | null; amount: string; quantity: number }[]; eaters: string[][][] } {
  const runs = portions(items);
  const lines: { label: string; labelEn: string | null; amount: string; quantity: number }[] = [];
  const eaters: string[][][] = [];
  for (let i = 0; i < items.length; ) {
    const run = runs[i];
    const count = run && run.start === i ? run.of : 1;
    const item = (count > 1 && foldedLine(items, i, count, currency)) || items[i]!;
    let amount = item.amount;
    try { amount = minorToDecimalString(parseMinor(item.amount, currency), currency); } catch { /* kept as typed */ }
    lines.push({ label: item.label, labelEn: item.labelEn ?? null, amount, quantity: item.quantity ?? 1 });
    const rows = Array.from({ length: count }, (_, k) => [...(assignments?.[i + k] ?? [])].sort());
    const same = rows.every((row) => row.join() === rows[0]!.join());
    eaters.push(same ? rows.slice(0, 1) : rows);
    i += count;
  }
  return { lines, eaters };
}

/**
 * A run's portions read as the single line they came from.
 *
 * **A view, never an edit.** Writing it back loses who had which portion and
 * moves money by a cent: 5.67/5.67/5.66 shared two ways doesn't round like one
 * 17.00 line.
 */
export function foldedLine(
  items: readonly ReceiptItem[],
  start: number,
  count: number,
  currency: string,
): ReceiptItem | null {
  const rows = items.slice(start, start + count);
  const head = rows[0];
  if (!head || rows.length < 2) return null;

  let minor = 0;
  for (const row of rows) {
    try { minor += parseMinor(row.amount, currency); } catch { return null; }
  }
  return {
    label: head.label,
    labelEn: head.labelEn,
    amount: minorToDecimalString(minor, currency),
    quantity: rows.reduce((n, row) => n + (row.quantity ?? 1), 0),
    portionOf: null,
  };
}

/** What one person's cell shows on a folded run. No mark at all means none. */
type RunMark = "some" | "all";

/** How a run of portions has been handed out, as its one folded row shows it. */
interface RunAssignment {
  /**
   * Somebody has some of the portions and not the others, so the run cannot be
   * edited while it is folded: a tap on one cell could mean either portion.
   */
  detailed: boolean;
  /** What each person's cell shows; absent from the map is an empty cell. */
  marks: Map<string, RunMark>;
}

/**
 * The run's rows, read as one row. A detailed run marks **everyone who had any
 * of it** as split, even whoever had all of it: none of its cells can be
 * tapped like an ordinary one. The rows underneath are the record.
 */
export function runAssignment(rows: readonly ReadonlySet<string>[]): RunAssignment {
  const counts = new Map<string, number>();
  for (const row of rows) for (const id of row) counts.set(id, (counts.get(id) ?? 0) + 1);
  const detailed = [...counts.values()].some((n) => n < rows.length);
  const marks = new Map<string, RunMark>();
  for (const id of counts.keys()) marks.set(id, detailed ? "some" : "all");
  return { detailed, marks };
}
