// Doc: docs/scan-reading.md
import {
  extrasMinor, minorToDecimalString, parseMinor, resolveSplit,
  type BillExtras, type ExtraKind, type ReceiptItem,
} from "@bida/core";

export interface MemberLine {
  label: string;
  extra?: ExtraKind;
  count: Count;
  minor: number;
}

interface Count { n: number; d: number }

interface BillLine { amount: string; label?: string; quantity?: number | null; portionOf?: number | null }

interface Labelled { label: string; labelEn?: string | null }

/**
 * The original is the default: the receipt in hand says those words, and a
 * silent "Tagine" → "Lamb stew" can't be checked against it.
 */
export function billLabel(line: Labelled, english: boolean): string {
  return english ? line.labelEn || line.label : line.label;
}

export function billLabels<T extends Labelled>(lines: readonly T[], english: boolean): readonly T[] {
  return english ? lines.map((line) => ({ ...line, label: billLabel(line, true) })) : lines;
}

export function billExtrasIn(extras: BillExtras, english: boolean): BillExtras {
  return english
    ? { ...extras, charges: [...billLabels(extras.charges, true)], discounts: [...billLabels(extras.discounts, true)] }
    : extras;
}

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

interface BillCharge { kind: ExtraKind; label: string; amount: string; seed: string }

export function billCharges(extras: BillExtras | null): BillCharge[] {
  if (!extras) return [];
  const off = extras.discounts.map((d, i) => (
    { kind: "discount" as const, label: d.label, amount: d.amount, seed: `discount${i}` }
  ));
  // An unnamed charge is the one tax bills kept before charges had names, and
  // keeps the seed it was saved with, or its odd cent could change hands.
  const on = extras.charges.map((c, i) => (
    { kind: "charge" as const, label: c.label, amount: c.amount, seed: c.label ? `charge${i}` : "tax" }
  ));
  const tip = extras.tip ? [{ kind: "tip" as const, label: "", amount: extras.tip, seed: "tip" }] : [];
  return [...off, ...on, ...tip];
}

/**
 * Extras are nobody's order, so each is spread in proportion to what people did
 * order (ADR-0016).
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
  const note = (id: string, line: MemberLine) => {
    const own = lines[id] ??= [];
    const same = own.find((l) => l.label === line.label && l.extra === line.extra);
    if (!same) { own.push(line); return; }
    same.count = plus(same.count, line.count);
    same.minor += line.minor;
  };

  const share = (i: number, rows: number, of: number) => {
    const item = items[i]!;
    const who = [...(assignments[i] ?? new Set<string>())];
    if (who.length === 0) return;
    let minor = 0;
    try {
      for (let k = i; k < i + rows; k++) minor += parseMinor(items[k]!.amount, currency);
    } catch { return; }
    if (minor <= 0) return;
    const { shares } = resolveSplit(minor, { mode: "equal", members: who }, { tiebreakSeed: `${seed}:item${i}` });
    for (const [id, v] of Object.entries(shares)) {
      add(id, v);
      note(id, { label: item.label ?? "", count: count(of, who.length), minor: v });
    }
  };

  const runs = portions(items);
  for (let i = 0; i < items.length; ) {
    const item = items[i]!;
    const run = runs[i];
    // A run every portion of which went to the same people is one line shared
    // by them: three 3.50 sodas between three are 3.50 each, where splitting
    // each portion three ways hands the odd cents out as 3.49/3.50/3.51.
    if (run?.index === 1 && sameEaters(assignments, i, run.of)) {
      share(i, run.of, run.of);
      i += run.of;
      continue;
    }
    share(i, 1, !item.portionOf && item.quantity && item.quantity > 1 ? Math.floor(item.quantity) : 1);
    i++;
  }

  const ordered = { ...weights };
  for (const charge of billCharges(extras)) {
    if (involved.size === 0) continue;
    let minor = 0;
    try { minor = parseMinor(charge.amount, currency); } catch { continue; /* mid-type */ }
    if (minor <= 0) continue;
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

  // A discount bigger than someone's order can't owe them money. `checkScan`
  // refuses such a scan; this floors one typed by hand.
  for (const [id, v] of Object.entries(weights)) if (v < 0) weights[id] = 0;

  // Dropped, not kept at 0: "shares" mode reads the keys as the participants.
  for (const id of Object.keys(weights)) if (weights[id] === 0) delete weights[id];
  return { weights, lines };
}

function sameEaters(assignments: readonly ReadonlySet<string>[], start: number, rows: number): boolean {
  const head = assignments[start] ?? new Set<string>();
  for (let k = start + 1; k < start + rows; k++) {
    const row = assignments[k] ?? new Set<string>();
    if (row.size !== head.size || [...row].some((id) => !head.has(id))) return false;
  }
  return true;
}

export function receiptTotalMinor(
  items: readonly { amount: string }[],
  extras: BillExtras | null,
  currency: string,
): number | null {
  let total = 0;
  let any = false;
  for (const item of items) {
    try { total += parseMinor(item.amount, currency); any = true; } catch { /* mid-type: worth nothing */ }
  }
  if (extras) total += extrasMinor(extras, currency) ?? 0;
  return any ? total : null;
}

// Unfolding: "Salad ×2 9.00" becomes two rows at half each, with their own
// eaters (ADR-0016). Portions are marked (`portionOf`), never inferred from
// equal labels, so two identical printed lines aren't mistaken for one.

interface Portion { start: number; index: number; of: number }

export function portions<T extends Pick<BillLine, "label" | "portionOf">>(items: readonly T[]): (Portion | null)[] {
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

export function printedCount(items: readonly ReceiptItem[]): number {
  return portions(items).filter((p) => !p || p.index === 1).length;
}

/**
 * Above it a line stays whole: a typed "1 million tomatoes" is a million rows
 * otherwise.
 */
export const MAX_PORTIONS = 100;

export function unfoldableInto(item: ReceiptItem, currency: string): number | null {
  const count = item.quantity ?? 0;
  if (!Number.isInteger(count) || count < 2 || count > MAX_PORTIONS || item.portionOf) return null;
  try { if (parseMinor(item.amount, currency) <= 0) return null; } catch { return null; }
  return count;
}

/** Sums to the line exactly, so the total and tip percentage don't move. */
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
    quantity: null,
    portionOf: count,
  }));
  return { items: [...items.slice(0, index), ...parts, ...items.slice(index + 1)], at: index, count };
}

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
 * A view, never an edit: writing it back loses who had which portion and moves
 * a cent, as 5.67/5.67/5.66 shared two ways doesn't round like one 17.00 line.
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

type RunMark = "some" | "all";

interface RunAssignment {
  detailed: boolean;
  marks: Map<string, RunMark>;
}

export function runAssignment(rows: readonly ReadonlySet<string>[]): RunAssignment {
  const counts = new Map<string, number>();
  for (const row of rows) for (const id of row) counts.set(id, (counts.get(id) ?? 0) + 1);
  const detailed = [...counts.values()].some((n) => n < rows.length);
  const marks = new Map<string, RunMark>();
  for (const id of counts.keys()) marks.set(id, detailed ? "some" : "all");
  return { detailed, marks };
}
