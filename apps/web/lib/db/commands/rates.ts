import {
  convertMinor, isValidRate, rateFor,
  type CurrencyCode, type ExchangeRate, type Id, type Rate, type RateSource,
} from "@bida/core";
import { db } from "../dexie";
import { appendOps } from "./append";

/**
 * What the group says a currency is worth, and from that what an entry in it
 * is worth. One live rate per currency, keyed by code. Entries are valued on
 * read (`atCurrentRates`), so the stored figure is only an opening position;
 * both come from the same rule here. ADR-0005.
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
 * The rate to write onto an entry: the group's, whenever it has one. Matters
 * when the form's number is stale (a scan set a currency, someone corrected
 * the rate mid-draft), so what's written is what the entry is read at.
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
 * The base amount written onto the entry. Takes three fields so a settlement
 * converts by exactly the same rule. Not what the entry is *worth* — the
 * registry answers that on read — but it keeps the row complete, and covers a
 * currency the registry later drops. ADR-0005.
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
 * Set a currency's rate. Keyed by code, so a create first and an update after;
 * two phones merge by HLC. **Only ever written on a Save** — a number that
 * moves every balance needs an actor and a history line, never a background
 * task. ADR-0005.
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
  // The one create that writes `deletedAt: null` (see `only`): the id is the
  // currency code, so re-setting a cleared rate lands on the tombstoned row and
  // must lift the tombstone.
  await appendOps(groupId, actor, [
    { entity: "rate", entityId: currency, kind: "create", patch: { ...patch, deletedAt: null } },
  ]);
}

/**
 * Drop a currency from the registry. Its entries fall back to the rate each
 * was saved with — "stop having an opinion", not "lose the money".
 */
export async function clearRate(groupId: Id, actor: Id, currency: CurrencyCode): Promise<void> {
  await appendOps(groupId, actor, [
    { entity: "rate", entityId: currency, kind: "delete", patch: {} },
  ]);
}
