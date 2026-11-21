// Doc: docs/who-had-what.md#a-split-by-days
import { stayLines, type DaysSplit } from "@bida/core";
import { copy } from "./copy";
import { bare, plural } from "./format";
import type { MemberLine } from "./scan/items";

/**
 * A stay's shares written out as sums, for `MemberBill`: "3 nights ÷4 · 25.00
 * … 75.00" — the caption the calendar prints under each of those rows, so the
 * two screens read one arithmetic. `total` and `shares` in one currency.
 */
export function stayBill(
  total: number, spec: DaysSplit, shares: Record<string, number>, currency: string,
): Record<string, MemberLine[]> {
  const out: Record<string, MemberLine[]> = {};
  for (const [id, { lines, rounding }] of Object.entries(stayLines(total, spec, shares))) {
    out[id] = lines.map((l) => ({
      label: plural(l.count, copy.stay.noun[spec.unit]),
      qty: copy.stay.each(l.heads, bare(l.each, currency)),
      count: { n: l.count, d: 1 },
      minor: l.minor,
    }));
    // The split's own cent, where it fell: said, so every line above checks.
    if (rounding !== 0) out[id]!.push({ label: copy.stay.rounding, qty: "", count: { n: 1, d: 1 }, minor: rounding, signed: true });
  }
  return out;
}
