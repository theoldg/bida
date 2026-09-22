import { convertMinor, isValidRate, type CurrencyCode, type Rate } from "./money.js";
import { alive, type ExchangeRate, type GroupState, type Id } from "./types.js";

/**
 * The group's rate registry, applied. A rate is the group's, so entries are
 * **valued on read** at today's rate — fix a typo and every entry follows
 * ([ADR-0005](../../../docs/decisions/0005-money-and-currency.md)). The entry's
 * own `rateToBase` is the fallback for a currency with no row.
 *
 * **Nothing here throws**: a bad rate from another phone costs that currency
 * its repricing, not the ledger its balances.
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
}

/**
 * One entry at the current rate, or untouched without one. Returns the same
 * object when nothing changes, so React isn't woken.
 */
export function repriceEntry<T extends RateBearing>(
  entry: T,
  base: CurrencyCode,
  rates: Record<CurrencyCode, ExchangeRate>,
): T {
  const rate = rateFor(rates, base, entry.currency);
  if (rate === undefined) return entry;
  let baseAmountMinor: number;
  try {
    baseAmountMinor = entry.currency === base
      ? entry.amountMinor
      : convertMinor(entry.amountMinor, entry.currency, base, rate);
  } catch {
    return entry; // out of range: keep what was stored rather than lose the row
  }
  if (baseAmountMinor === entry.baseAmountMinor && rate === entry.rateToBase) return entry;
  return { ...entry, rateToBase: rate, baseAmountMinor };
}

/**
 * A whole group at current rates. Run once where state is assembled — a
 * screen that misses it reports different numbers from the rest.
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

/** One currency the group spends in, and how much of the ledger is in it. */
export interface CurrencyInUse {
  currency: CurrencyCode;
  /** Live expenses and transfers carrying it. Zero for a rate added by hand. */
  entryCount: number;
  /** The registry's row, absent until somebody sets one. */
  rate: ExchangeRate | undefined;
}

/**
 * Every currency needing a rate: those in use plus those added in advance,
 * never the base. Sorted by how much of the ledger rides on each.
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
  for (const r of alive(state.rates)) if (r.id !== base) counts.set(r.id, counts.get(r.id) ?? 0);

  return [...counts.entries()]
    .map(([currency, entryCount]): CurrencyInUse => {
      const row = state.rates[currency];
      return { currency, entryCount, rate: row && !row.deletedAt ? row : undefined };
    })
    .sort((a, b) => b.entryCount - a.entryCount || a.currency.localeCompare(b.currency));
}
