import { cleanAmountText, parseMinor, resolveSplit } from "@hajsik/core";

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
    try { minor = parseMinor(cleanAmountText(item.amount), currency); } catch { return; }
    if (minor <= 0) return;
    const { shares } = resolveSplit(minor, { mode: "equal", members: who }, { tiebreakSeed: `${seed}:item${i}` });
    for (const [id, v] of Object.entries(shares)) add(id, v);
  });

  if (tip && tip.members.size > 0) {
    let minor = 0;
    try { minor = parseMinor(cleanAmountText(tip.amount), currency); } catch { /* no tip, no problem */ }
    if (minor > 0) {
      const { shares } = resolveSplit(
        minor, { mode: "equal", members: [...tip.members] }, { tiebreakSeed: `${seed}:tip` },
      );
      for (const [id, v] of Object.entries(shares)) add(id, v);
    }
  }

  // Zero-weight members are dropped, not kept at 0: "shares" mode reads
  // Object.keys() as the participant list, so a 0 would still owe nothing.
  for (const id of Object.keys(weights)) if (weights[id] === 0) delete weights[id];
  return weights;
}
