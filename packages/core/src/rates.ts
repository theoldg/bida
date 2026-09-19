import { convertMinor, isValidRate, type CurrencyCode, type Rate } from "./money.js";
import { alive, type ExchangeRate, type GroupState, type Id } from "./types.js";

/**
 * The group's exchange-rate registry, applied.
 *
 * A rate is not a fact about one entry, it is a fact about the group: one
 * number per currency, agreed by everybody, corrected in one place. So an
 * entry in a foreign currency is **valued on read** at whatever the registry
 * says today — fix a rate somebody fat-fingered and every entry in that
 * currency follows, which is the whole reason the registry exists
 * ([ADR-0005](../../../docs/decisions/0005-money-and-currency.md)).
 *
 * The rate a device typed at save is still written onto the entry, and it is
 * still what the log records. It is no longer what the entry is worth — it is
 * the fallback for the one case the registry cannot answer: a currency with no
 * row, which is every foreign entry in a group written before the registry
 * existed. Those keep converting at exactly the number they always did.
 *
 * Nothing here throws. A rate is a string somebody typed on another phone; a
 * bad one must cost that currency its repricing, not the whole ledger its
 * balances.
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
 * One entry at the group's current rate, or the entry untouched when the
 * registry has nothing to say about its currency.
 *
 * Returns the same object when nothing changes, so a re-priced state is cheap
 * to compare and a React render is not woken by a pass that did nothing.
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
 * A whole group valued at its current rates: every expense and every transfer.
 *
 * This is what every reader of a `GroupState` wants — balances, the ledger,
 * settle-up, one entry's detail screen — so it runs once where the state is
 * assembled rather than being threaded through each of them. Miss it in one
 * place and that screen quietly reports a different number from the rest of
 * the app, which is the failure this whole feature is about.
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
 * Every currency the registry has to answer for: the ones entries are actually
 * written in, plus the ones somebody added ahead of spending in them. The
 * group's own base currency is never one of them — it is what the others are
 * measured in.
 *
 * Sorted by how much of the ledger rides on it, so the currency the trip is
 * actually being spent in is the first row.
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
