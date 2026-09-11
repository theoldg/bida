import { minorToDecimalString, parseMinor, resolveSplit, type ReceiptItem, type SplitMode } from "@hajsik/core";

/** A line of the bill, and how much of it was one person's. */
export interface MemberLine {
  /** The bill's own label. Empty for the tip, which is nobody's order. */
  label: string;
  /** The tip line, which is charged for but not ordered. */
  tip?: boolean;
  /** How much of it was theirs — one, two, or a third of a shared plate. */
  count: Count;
  /** What that came to, in the receipt's own currency. */
  minor: number;
}

/** A count that can be a share of one: `n/d`, always in lowest terms. */
export interface Count { n: number; d: number }

/** What a bill's line has to say for itself here. `ReceiptItem` satisfies it. */
interface BillLine { amount: string; label?: string; quantity?: number | null; portionOf?: number | null }

function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }

function count(n: number, d: number): Count {
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
}

function plus(a: Count, b: Count): Count { return count(a.n * b.d + b.n * a.d, a.d * b.d); }

/**
 * Who had what, read two ways at once: as split weights, and as each person's
 * own copy of the bill.
 *
 * Each item's printed amount is divided evenly among the members checked for
 * that row (the same largest-remainder rule as a real split), then the
 * per-member results are summed. The sum is only ever used as a *ratio*
 * against the expense's real, converted total — see the split editor's
 * "shares" mode — so it doesn't matter that it's denominated in the receipt's
 * own currency rather than the group's base currency.
 *
 * The lines are that same arithmetic, kept rather than summed away: one entry
 * per label, carrying how much of it was theirs. They are what the entry
 * screen expands a person's row into, and they add up to that person's weight
 * by construction — there is no second calculation to drift from this one.
 */
export function receiptBreakdown(
  items: readonly BillLine[],
  assignments: readonly Set<string>[],
  tip: { amount: string; members: Set<string> } | null,
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
    const same = own.find((l) => l.label === line.label && !l.tip === !line.tip);
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

  if (tip && tip.members.size > 0) {
    let minor = 0;
    try { minor = parseMinor(tip.amount, currency); } catch { /* no tip, no problem */ }
    if (minor > 0) {
      // Scale the tip to what each person already ordered, not an even split —
      // someone who had the €40 steak tips more than someone who had a coffee.
      // Only members with a positive item weight can take a proportional
      // share; if none of the tip's members have one yet (nobody's assigned
      // anything), fall back to splitting the tip evenly so it isn't silently
      // dropped.
      const proportional: Record<string, number> = {};
      for (const id of tip.members) if (weights[id]) proportional[id] = weights[id];
      const { shares } = Object.keys(proportional).length > 0
        ? resolveSplit(minor, { mode: "shares", weights: proportional }, { tiebreakSeed: `${seed}:tip` })
        : resolveSplit(minor, { mode: "equal", members: [...tip.members] }, { tiebreakSeed: `${seed}:tip` });
      for (const [id, v] of Object.entries(shares)) {
        add(id, v);
        note(id, { label: "", tip: true, count: count(1, 1), minor: v });
      }
    }
  }

  // Zero-weight members are dropped, not kept at 0: "shares" mode reads
  // Object.keys() as the participant list, so a 0 would still owe nothing.
  for (const id of Object.keys(weights)) if (weights[id] === 0) delete weights[id];
  return { weights, lines };
}

/** The weights alone — what the split is derived from (ADR-0016). */
export function weightsFromItems(
  items: readonly BillLine[],
  assignments: Set<string>[],
  tip: { amount: string; members: Set<string> } | null,
  currency: string,
  seed: string,
): Record<string, number> {
  return receiptBreakdown(items, assignments, tip, currency, seed).weights;
}

/**
 * The receipt's own total: every line item plus the tip, in the receipt's
 * currency. This is what Receipt mode treats as the expense amount — derived
 * from the bill, not typed separately — so it stays in lockstep with whatever
 * "who had what" actually adds up to. Returns null when there's nothing to
 * sum (no items parse), so the caller can leave the amount alone rather than
 * overwrite it with zero.
 */
export function receiptTotalMinor(
  items: { amount: string }[],
  tip: string | null,
  currency: string,
): number | null {
  let total = 0;
  let any = false;
  for (const item of items) {
    try { total += parseMinor(item.amount, currency); any = true; } catch { /* unreadable line, skip it */ }
  }
  if (tip) {
    try { total += parseMinor(tip, currency); } catch { /* no tip, no problem */ }
  }
  return any ? total : null;
}

/**
 * The amount to write into the draft when a tab change takes the total back
 * off Receipt mode — or null to leave the amount field alone.
 *
 * Receipt's total is derived at read time and deliberately never cached
 * (ADR-0016), which holds for exactly as long as the Receipt tab is the one
 * showing it. Switching to Evenly / As parts / As amounts ends that: the
 * person is taking the number back by hand, and the only place a typed amount
 * lives is `amountText`. The split already makes precisely this handoff, via
 * `convertSplitMode`; this is its missing other half. Without it the amount
 * falls back to whatever `amountText` held before the scan — routinely
 * nothing, because OCR often reads the line items and misses the printed
 * total — and the expense silently becomes worth zero, which surfaces as a
 * greyed-out Save and the "€0.00 of €0.00 allocated" footer.
 *
 * A one-shot conversion at an explicit user action, not a mirror: it fires
 * only on the receipt → arithmetic transition, so switching between two
 * arithmetic tabs never snaps a hand-typed amount back to what the bill says.
 */
export function handOffReceiptTotal(
  from: SplitMode,
  to: SplitMode,
  items: { amount: string }[] | null | undefined,
  tip: string | null | undefined,
  currency: string,
): string | null {
  if (from !== "receipt" || to === "receipt") return null;
  const total = receiptTotalMinor(items ?? [], tip ?? null, currency);
  // `minorToDecimalString`, not `bare`: what goes into `amountText` has to
  // be canonical text `parseMinor` can read back. `bare` groups thousands.
  return total === null ? null : minorToDecimalString(total, currency);
}

/**
 * Unfolding a printed line into separately assignable portions.
 *
 * A receipt prints "Salad ×2  9.00" as one line, but two salads can have been
 * eaten by different people — Alice and Bob shared one, Charlie had the other.
 * One row can't say that, so the row becomes two, each carrying half the
 * printed amount and its own set of eaters. Nothing downstream learns a new
 * concept: the grid still reduces to weights, and the bill is still the sum of
 * its lines. ADR-0016.
 *
 * Portions are marked (`portionOf`), not inferred from equal labels, so a
 * receipt that happens to print two identical lines isn't drawn as something
 * that was unfolded — and so merging back is exact.
 */

/** Where a row sits in an unfolded group: its start, its place, the size. */
export interface Portion { start: number; index: number; of: number }

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
    amount: minorToDecimalString(each + (i < remainder ? 1 : 0), currency),
    // The printed count belongs to the line that's gone; a portion is one of.
    quantity: null,
    portionOf: count,
  }));
  return { items: [...items.slice(0, index), ...parts, ...items.slice(index + 1)], at: index, count };
}

/**
 * The inverse: `count` rows from `start` become the one line they came from,
 * amounts summed back up and the count printed again as its quantity.
 */
export function foldPortions(
  items: readonly ReceiptItem[],
  start: number,
  count: number,
  currency: string,
): { items: ReceiptItem[]; at: number } | null {
  const rows = items.slice(start, start + count);
  const head = rows[0];
  if (!head || rows.length < 2) return null;

  let minor = 0;
  for (const row of rows) {
    try { minor += parseMinor(row.amount, currency); } catch { return null; }
  }
  const merged: ReceiptItem = {
    label: head.label,
    amount: minorToDecimalString(minor, currency),
    quantity: rows.reduce((n, row) => n + (row.quantity ?? 1), 0),
    portionOf: null,
  };
  return { items: [...items.slice(0, start), merged, ...items.slice(start + count)], at: start };
}
