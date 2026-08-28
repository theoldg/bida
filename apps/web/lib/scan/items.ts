import { minorToDecimalString, parseMinor, resolveSplit, type SplitTab } from "@hajsik/core";

/**
 * Turns "who had what" on a scanned receipt into split weights.
 *
 * Each item's printed amount is divided evenly among the members checked for
 * that row (the same largest-remainder rule as a real split), then the
 * per-member results are summed. The sum is only ever used as a *ratio*
 * against the expense's real, converted total — see the split editor's
 * "shares" mode — so it doesn't matter that it's denominated in the
 * receipt's own currency rather than the group's base currency.
 */
export function weightsFromItems(
  items: { amount: string }[],
  assignments: Set<string>[],
  tip: { amount: string; members: Set<string> } | null,
  currency: string,
  seed: string,
): Record<string, number> {
  const weights: Record<string, number> = {};
  const add = (id: string, minor: number) => { weights[id] = (weights[id] ?? 0) + minor; };

  items.forEach((item, i) => {
    const who = [...(assignments[i] ?? new Set())];
    if (who.length === 0) return;
    let minor = 0;
    try { minor = parseMinor(item.amount, currency); } catch { return; }
    if (minor <= 0) return;
    const { shares } = resolveSplit(minor, { mode: "equal", members: who }, { tiebreakSeed: `${seed}:item${i}` });
    for (const [id, v] of Object.entries(shares)) add(id, v);
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
      for (const [id, v] of Object.entries(shares)) add(id, v);
    }
  }

  // Zero-weight members are dropped, not kept at 0: "shares" mode reads
  // Object.keys() as the participant list, so a 0 would still owe nothing.
  for (const id of Object.keys(weights)) if (weights[id] === 0) delete weights[id];
  return weights;
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
 * (ADR-0020), which holds for exactly as long as the Receipt tab is the one
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
  from: SplitTab,
  to: SplitTab,
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
