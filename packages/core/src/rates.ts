import { convertMinor, isValidRate, type CurrencyCode, type Rate } from "./money.js";
import {
  alive, type EntryRateSource, type ExchangeRate, type GroupState, type Id,
} from "./types.js";

/**
 * What an entry is worth in the group's currency. **The rate is the entry's
 * own**, frozen at save from the feed for its day
 * ([ADR-0005](../../../docs/decisions/0005-money-and-currency.md)). The
 * registry only values an entry written before that — one with no
 * `rateSource` — until `entriesCarryTheirOwnRate` writes the registry's rate
 * onto it.
 *
 * **Nothing here throws**: a bad rate from another phone costs that entry its
 * repricing, not the ledger its balances.
 */

/** The registry's rate for a currency, or undefined when it hasn't got one. */
export function rateFor(
  rates: Record<CurrencyCode, ExchangeRate>,
  base: CurrencyCode,
  currency: CurrencyCode,
): Rate | undefined {
  if (currency === base) return "1";
  const row = rates[currency];
  if (!row || row.deletedAt || !isValidRate(row.rate)) return undefined;
  return row.rate;
}

/** The fields repricing reads and writes — an expense and a transfer share them. */
interface RateBearing {
  amountMinor: number;
  currency: CurrencyCode;
  rateToBase: Rate;
  baseAmountMinor: number;
  rateSource?: EntryRateSource | null;
}

/**
 * The rate an entry is read at: its own, or for an entry from before rates
 * were the entry's, the registry's while it has one.
 */
function rateOf(entry: RateBearing, base: CurrencyCode, rates: Record<CurrencyCode, ExchangeRate>): Rate {
  if (entry.currency === base) return "1";
  if (entry.rateSource) return entry.rateToBase;
  return rateFor(rates, base, entry.currency) ?? entry.rateToBase;
}

/**
 * One entry at the rate it is read at, its base figure re-derived from it —
 * so a merge that pairs one phone's amount with another's rate still reads
 * consistently. Returns the same object when nothing changes, so React isn't
 * woken.
 */
export function repriceEntry<T extends RateBearing>(
  entry: T,
  base: CurrencyCode,
  rates: Record<CurrencyCode, ExchangeRate>,
): T {
  const rate = rateOf(entry, base, rates);
  let baseAmountMinor: number;
  try {
    baseAmountMinor = entry.currency === base
      ? entry.amountMinor
      : convertMinor(entry.amountMinor, entry.currency, base, rate);
  } catch {
    return entry; // out of range or unreadable: keep what was stored rather than lose the row
  }
  if (baseAmountMinor === entry.baseAmountMinor && rate === entry.rateToBase) return entry;
  return { ...entry, rateToBase: rate, baseAmountMinor };
}

/**
 * A whole group at the rates its entries are read at. Run once where state is
 * assembled — a screen that misses it reports different numbers from the rest.
 */
export function atCurrentRates(state: GroupState): GroupState {
  const base = state.group?.baseCurrency;
  if (!base) return state;
  const reprice = <T extends RateBearing>(rows: Record<Id, T>): Record<Id, T> => {
    let changed = false;
    const out: Record<Id, T> = {};
    for (const [id, row] of Object.entries(rows)) {
      const next = repriceEntry(row, base, state.rates);
      if (next !== row) changed = true;
      out[id] = next;
    }
    return changed ? out : rows;
  };
  const expenses = reprice(state.expenses);
  const settlements = reprice(state.settlements);
  if (expenses === state.expenses && settlements === state.settlements) return state;
  return { ...state, expenses, settlements };
}

/** What `latestRate` reads off an entry. */
interface Dated {
  id: Id;
  currency: CurrencyCode;
  rateToBase: Rate;
  occurredAt: number;
  createdAt?: number;
  deletedAt?: number | null;
}

/**
 * The rate a new entry borrows when the feed can't be reached: the group's
 * most recent live entry in that currency (by `occurredAt`, then `createdAt`),
 * else the registry's old row. Undefined for a currency new to the group —
 * the one case the rate dialog opens for. Pass entries already repriced.
 */
export function latestRate(
  entries: readonly Dated[],
  rates: Record<CurrencyCode, ExchangeRate>,
  base: CurrencyCode,
  currency: CurrencyCode,
  except?: Id,
): Rate | undefined {
  if (currency === base) return "1";
  let best: Dated | undefined;
  for (const e of entries) {
    if (e.deletedAt || e.id === except || e.currency !== currency || !isValidRate(e.rateToBase)) continue;
    if (!best || e.occurredAt > best.occurredAt
      || (e.occurredAt === best.occurredAt && (e.createdAt ?? 0) > (best.createdAt ?? 0))) best = e;
  }
  return best?.rateToBase ?? rateFor(rates, base, currency);
}

/** One currency the group spends in, and how much of the ledger is in it. */
export interface CurrencyInUse {
  currency: CurrencyCode;
  /** Live expenses and transfers carrying it. */
  entryCount: number;
}

/**
 * Every currency the group has spent in, never the base, busiest first: what
 * the currency picker lists ahead of the rest.
 */
export function currenciesInUse(state: GroupState): CurrencyInUse[] {
  const base = state.group?.baseCurrency;
  const counts = new Map<CurrencyCode, number>();
  const bump = (currency: CurrencyCode) => {
    if (currency === base) return;
    counts.set(currency, (counts.get(currency) ?? 0) + 1);
  };
  for (const e of alive(state.expenses)) bump(e.currency);
  for (const s of alive(state.settlements)) bump(s.currency);

  return [...counts.entries()]
    .map(([currency, entryCount]): CurrencyInUse => ({ currency, entryCount }))
    .sort((a, b) => b.entryCount - a.entryCount || a.currency.localeCompare(b.currency));
}
