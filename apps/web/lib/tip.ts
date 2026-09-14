import { resolveSplit } from "@bida/core";

/**
 * The ask, in US cents.
 *
 * Dollars and not the group's currency on purpose: this is a price somebody
 * else charges, in the currency they charge it in, and converting it would
 * need a USD rate the group has no reason to hold
 * ([ADR-0005](../../../docs/decisions/0005-money-and-currency.md)). The share
 * below is therefore dollars too — the one figure on the tip screen that is
 * not the group's own money, said in the only currency that makes it true.
 *
 * It is the same $5 the copy quotes and the day cap is set from
 * (`SCAN_LIMITS`, core/scan.ts): if the price moves, all three move.
 */
export const TIP_USD_MINOR = 500;

/**
 * What the tip comes to each, for "In this group, that's $1.67 each".
 *
 * The app's own even split, not a division — five dollars three ways is
 * 167/167/166 — and the **largest** share, because that is what somebody
 * would actually be asked for and a screen asking for money must never round
 * its own figure down. A group with nobody in it is the whole tip: there is
 * no one to share it with.
 */
export function tipShareMinor(memberIds: string[]): number {
  if (memberIds.length === 0) return TIP_USD_MINOR;
  const { shares } = resolveSplit(TIP_USD_MINOR, { mode: "equal", members: memberIds });
  return Math.max(...Object.values(shares));
}
