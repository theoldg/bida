import {
  convertMinor, isValidRate,
  type CurrencyCode, type EntryRateSource, type Id, type Rate,
} from "@bida/core";
import { db } from "../dexie";

/**
 * What an entry is worth: its own rate, frozen onto it at save, and the base
 * figure that rate makes of its amount. Both writes take them from here, so a
 * settlement converts by exactly the rule an expense does. ADR-0005.
 */

/** The group's base currency, which every entry write needs. */
export async function baseOf(groupId: Id): Promise<CurrencyCode> {
  const group = await db().groups.get(groupId);
  if (!group) throw new Error(`unknown group: ${groupId}`);
  return group.baseCurrency;
}

/** The rate fields an entry write carries. */
export interface RateInput {
  amountMinor: number;
  currency: CurrencyCode;
  rateToBase: Rate;
  /** Where the rate came from. Ignored, and cleared, on a base-currency entry. */
  rateSource?: EntryRateSource | null;
}

/**
 * The entry's rate fields as written: "1" and no source in the base currency,
 * else the rate it was given. **Refuses a foreign entry with no rate of its
 * own** — "1" there banks a 500 MAD dinner as €500.
 */
export function rateFields(input: RateInput, base: CurrencyCode): {
  rateToBase: Rate; baseAmountMinor: number; rateSource: EntryRateSource | null;
} {
  if (input.currency === base) {
    return { rateToBase: "1", baseAmountMinor: input.amountMinor, rateSource: null };
  }
  const rate = input.rateToBase.trim();
  if (!isValidRate(rate)) {
    throw new RangeError(`no rate for ${input.currency}: ${JSON.stringify(input.rateToBase)}`);
  }
  return {
    rateToBase: rate,
    baseAmountMinor: convertMinor(input.amountMinor, input.currency, base, rate),
    // An entry from before rates were the entry's, edited by a phone that never
    // said where its rate came from: the registry's, which is what it was read at.
    rateSource: input.rateSource ?? "group",
  };
}
