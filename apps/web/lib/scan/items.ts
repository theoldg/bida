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
 * **The original is the default**, everywhere and always: the person holding
 * the receipt is reading those same words, and a screen that silently renames
 * "Tagine" to "Lamb stew" cannot be checked against the paper. English is a
 * tap on the who-had-what bar (components/who-had-what.tsx), device-local and
 * remembered, and it reaches the saved expense's copy of the bill too.
 *
 * Falls back to the original for a line the model gave no English for — a bill
 * half in one language and half in the other is one the scan already read
 * right, and a blank label would be the only real loss on this screen.
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
 * Whether anything on this bill reads differently in English — which is what
 * decides whether the toggle is drawn at all. A receipt printed in English
 * comes back with no translation on any line, and a control that does nothing
 * is worse than no control.
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
 * The extras as a flat list, in the order a printed bill rules them off under
 * the items — every deduction by name, then the tax, then the tip.
 *
 * Each deduction is spread on its own rather than as one pooled figure. The
 * two divide identically, but this way each person's copy of the bill can say
 * "2 for 1 −4.44" rather than one number they'd have to take on trust.
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
 * own copy of the bill.
 *
 * Each item's printed amount divides evenly among the members checked for that
 * row (the same largest-remainder rule as a real split), then the per-member
 * results are summed. The sum is only ever a *ratio* against the expense's
 * converted total, so its being in the receipt's currency doesn't matter.
 *
 * The extras — tip, tax, discount — are nobody's order and can't be ticked
 * for, so each is spread in proportion to what people did order, the discount
 * coming off (`BillExtras`). Proportional is the only division the grid can
 * justify with no way to say whose a credit is, and a discount exists because
 * of the whole order anyway (ADR-0016).
 *
 * The lines are that arithmetic kept rather than summed away: one entry per
 * label with how much of it was theirs. They add up to the person's weight by
 * construction, so there is no second calculation to drift from this one.
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

  // What each person ordered, fixed before a single extra is spread: all of
  // them divide by that same ratio, so the tip a person pays doesn't change
  // how much of the tax or of a discount is theirs, and the order they're
  // applied in can't matter.
  const ordered = { ...weights };
  for (const charge of billCharges(extras)) {
    if (involved.size === 0) continue;
    let minor = 0;
    try { minor = parseMinor(charge.amount, currency); } catch { continue; /* mid-type */ }
    if (minor <= 0) continue;
    // Scaled to what each person already ordered, not split evenly: whoever
    // had the €40 steak tips more, and takes more of the loyalty discount,
    // than whoever had a coffee. Only a positive item weight can take a
    // proportional share, so with nothing assigned yet it falls back to an
    // even split rather than dropping the figure.
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
 * The receipt's own total: every line item, plus tip and tax, less discounts,
 * in the receipt's currency. Receipt mode treats it as the expense amount —
 * derived from the bill, never typed separately — so it stays in lockstep with
 * what "who had what" adds up to. Null when there is nothing to sum, so the
 * caller leaves the amount alone rather than overwriting it with zero.
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
 * The amount to write into the draft when a tab change takes the total back
 * off Receipt mode — or null to leave the amount field alone.
 *
 * Receipt's total is derived at read time and never cached (ADR-0016), which
 * holds only while the Items tab is showing it. Switching to an arithmetic tab
 * ends that: the person is taking the number back by hand, and a typed amount
 * lives only in `amountText`. This is the amount half of the handoff
 * `convertSplitMode` makes for the split; without it the amount falls back to
 * whatever preceded the scan — routinely nothing, since OCR often reads the
 * line items and misses the printed total — and the expense is worth zero.
 *
 * **A one-shot conversion at an explicit action, not a mirror.** It fires only
 * on receipt → arithmetic, so moving between two arithmetic tabs never snaps a
 * hand-typed amount back to what the bill says.
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
 * Unfolding a printed line into separately assignable portions.
 *
 * A receipt prints "Salad ×2  9.00" as one line, but the two salads can have
 * gone to different people. One row can't say that, so it becomes two, each
 * carrying half the printed amount and its own eaters. Nothing downstream
 * learns a new concept: the grid still reduces to weights and the bill is
 * still the sum of its lines. ADR-0016.
 *
 * **Portions are marked (`portionOf`), never inferred from equal labels**, so
 * a receipt printing two identical lines isn't drawn as an unfolded one — and
 * merging back is exact.
 */

/** Where a row sits in an unfolded group: its start, its place, the size. */
interface Portion { start: number; index: number; of: number }

/**
 * One entry per item: null for an ordinary printed line, else the portion it
 * is. A run counts only when all `of` consecutive rows agree on the label and
 * the count, so a half-deleted group degrades to ordinary lines rather than
 * rendering a bracket around the wrong rows.
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

/** The count a printed line can be unfolded into, or null if it can't be. */
export function unfoldableInto(item: ReceiptItem, currency: string): number | null {
  const count = item.quantity ?? 0;
  if (!Number.isInteger(count) || count < 2 || item.portionOf) return null;
  try { if (parseMinor(item.amount, currency) <= 0) return null; } catch { return null; }
  return count;
}

/**
 * Split `items[index]` into one row per printed unit. The portions sum to the
 * line exactly — the remainder goes to the earliest ones, a cent at a time —
 * so the bill's total, and the tip percentage read off it, don't move.
 *
 * Returns the new list plus where it grew, so the caller can widen the grid's
 * assignment rows in step, or null when the line isn't unfoldable.
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
 * The portions of one run, read as the single line they came from: amounts
 * summed back up and the count printed again as its quantity.
 *
 * **A view, never an edit.** Writing this line back over the portions throws
 * away which of them was whose, and moves money by a cent: three portions of
 * 5.67/5.67/5.66 shared two ways do not round like one 17.00 line. The bill
 * keeps its portions once it has them; this is how the grid draws them while
 * the run is closed.
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
 * The run's rows, read as one row.
 *
 * A detailed run marks **everyone who had any of it** the same split way, even
 * the person who had all three: no cell in such a row may look like an ordinary
 * assignment, because none of them can be tapped like one. What "2 of 3" was is
 * still in the rows underneath, a tap away — this is the cover, not the record.
 */
export function runAssignment(rows: readonly ReadonlySet<string>[]): RunAssignment {
  const counts = new Map<string, number>();
  for (const row of rows) for (const id of row) counts.set(id, (counts.get(id) ?? 0) + 1);
  const detailed = [...counts.values()].some((n) => n < rows.length);
  const marks = new Map<string, RunMark>();
  for (const id of counts.keys()) marks.set(id, detailed ? "some" : "all");
  return { detailed, marks };
}
