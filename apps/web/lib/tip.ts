import { resolveSplit } from "@bida/core";

/**
 * The ask, in US cents — not the group's currency: converting would need a
 * USD rate the group has no reason to hold
 * ([ADR-0005](../../../docs/decisions/0005-money-and-currency.md)).
 *
 * The same $5 the copy quotes and the day cap is set from (`SCAN_LIMITS`,
 * core/scan.ts): **if the price moves, all three move.**
 */
export const TIP_USD_MINOR = 500;

/**
 * Each person's share of the tip, via the app's own even split (167/167/166)
 * and the **largest** share — never round an ask down. An empty group is the
 * whole tip.
 */
export function tipShareMinor(memberIds: string[]): number {
  if (memberIds.length === 0) return TIP_USD_MINOR;
  const { shares } = resolveSplit(TIP_USD_MINOR, { mode: "equal", members: memberIds });
  return Math.max(...Object.values(shares));
}
