import {
  convertMinor, isValidRate, rateFor,
  type CurrencyCode, type ExchangeRate, type Id, type Rate, type RateSource,
} from "@bida/core";
import { db } from "../dexie";
import { appendOps } from "./append";

/**
 * What the group says a currency is worth — and, from that, what an entry
 * written in one is worth.
 *
 * One live rate per currency, keyed by the code, shared like any other fact on
 * the log. Entries are valued against it when they are read (`atCurrentRates`),
 * so the figure stored on an entry is only its opening position; both are
 * derived here, by the same three lines, so they cannot have been derived by
 * different rules. ADR-0005.
 */

/** The group's base currency and its registry, which every entry write needs. */
export async function valuationOf(
  groupId: Id,
): Promise<{ base: CurrencyCode; rates: Record<CurrencyCode, ExchangeRate> }> {
  const d = db();
  const [group, rows] = await Promise.all([
    d.groups.get(groupId),
    d.rates.where("groupId").equals(groupId).toArray(),
  ]);
  if (!group) throw new Error(`unknown group: ${groupId}`);
  return {
    base: group.baseCurrency,
    rates: Object.fromEntries(rows.map((r) => [r.id, r])),
  };
}

/**
 * The rate to write onto an entry: the group's, whenever the group has one.
 *
 * The form can only offer the registry's number, so this agrees with it in
 * every ordinary case. It matters for the ones that aren't: a scan that set a
 * currency, a draft that was open while somebody else corrected the rate. What
 * gets written is then the same number the entry will be read at rather than a
 * stale one that only shows up in the history.
 */
export function rateToWrite(
  currency: CurrencyCode,
  asked: Rate,
  base: CurrencyCode,
  rates: Record<CurrencyCode, ExchangeRate>,
): Rate {
  return rateFor(rates, base, currency) ?? asked;
}

/**
 * The base amount written onto the entry. Takes the three fields rather than
 * an `ExpenseInput`, because a settlement converts by exactly the same rule
 * and must not drift from it.
 *
 * This figure is no longer what the entry is *worth* — the registry answers
 * that, on read (`atCurrentRates`). It is written so the row is complete and
 * self-consistent the moment it lands, and so a currency the registry later
 * has nothing to say about still has a number behind it. ADR-0005.
 */
export function toBase(
  input: { amountMinor: number; currency: CurrencyCode; rateToBase: Rate },
  base: CurrencyCode,
): number {
  return input.currency === base
    ? input.amountMinor
    : convertMinor(input.amountMinor, input.currency, base, input.rateToBase);
}

/**
 * Set what the group says a currency is worth. One row per currency, keyed by
 * the code, so this is a create the first time and an update after — and two
 * phones correcting the same rate merge by HLC like any other entity.
 *
 * A rate the app fetched is only ever written from here, which is to say only
 * when somebody pressed Save on it. Nothing in the app writes a rate on its
 * own: a number that moves every balance in the group is a change with an
 * actor and a line in the history, not a background task. ADR-0005.
 */
export async function setRate(
  groupId: Id,
  actor: Id,
  currency: CurrencyCode,
  rate: Rate,
  source: RateSource,
  asOf: number,
): Promise<void> {
  if (!isValidRate(rate)) throw new RangeError(`setRate: ${JSON.stringify(rate)} is not a rate`);
  const { base } = await valuationOf(groupId);
  if (currency === base) {
    throw new RangeError(`setRate: ${currency} is the group's own currency`);
  }
  const existing = await db().rates.get([groupId, currency]);
  const patch = { rate: rate.trim(), source, asOf };
  if (existing && !existing.deletedAt) {
    if (existing.rate === patch.rate && existing.source === source) return;
    await appendOps(groupId, actor, [
      { entity: "rate", entityId: currency, kind: "update", patch },
    ]);
    return;
  }
  // The one create that does write `deletedAt: null` rather than leaving it
  // absent (see `only`): a rate's id is its currency code, so setting one the
  // group had cleared lands on the existing tombstoned row and has to lift the
  // tombstone. Every other entity gets a fresh id and can never be reviving.
  await appendOps(groupId, actor, [
    { entity: "rate", entityId: currency, kind: "create", patch: { ...patch, deletedAt: null } },
  ]);
}

/**
 * Drop a currency from the registry. Entries written in it fall back to the
 * rate each was saved with, which is what a group that never had a registry
 * has always done — so this is "stop having an opinion", not "lose the money".
 */
export async function clearRate(groupId: Id, actor: Id, currency: CurrencyCode): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "rate", entityId: currency, kind: "delete", patch: {} },
  ]);
}
