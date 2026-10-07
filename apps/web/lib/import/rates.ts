import { ratesWanted, type CurrencyCode, type ImportPlan, type RateFor, type Rate } from "@bida/core";
import { fetchRate, RateOfflineError } from "../rates";

/**
 * The rates a plan in several currencies needs, looked up before anything is
 * written: one per foreign currency per day, from the same endpoint an entry
 * form asks (`lib/rates.ts`).
 *
 * **A day the feed misses borrows the nearest day it answered for**, in that
 * currency, marked `copied` as a form's fallback is. A currency with no answer
 * at all stops the import — banking a whole currency at a guess is not on —
 * and the person is told which.
 */

/** In flight at once: a long trip is a hundred days, and the endpoint is ours. */
const PARALLEL = 6;

/** No rate came back at all for these currencies. `offline` says why, when it was the phone. */
export class RatesUnavailableError extends Error {
  constructor(readonly currencies: CurrencyCode[], readonly offline: boolean) {
    super(`no rates for ${currencies.join(", ")}`);
  }
}

export async function lookUpRates(
  plan: ImportPlan,
  fetch: typeof fetchRate = fetchRate,
): Promise<RateFor> {
  const wanted = ratesWanted(plan);
  const got = new Map<CurrencyCode, { day: string; rate: Rate }[]>();
  let offline = false;

  let next = 0;
  async function worker() {
    while (next < wanted.length) {
      const { currency, day } = wanted[next++]!;
      try {
        const { rate } = await fetch(currency, plan.currency, day);
        got.set(currency, [...(got.get(currency) ?? []), { day, rate }]);
      } catch (err) {
        if (err instanceof RateOfflineError) offline = true;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, wanted.length) }, worker));

  const missing = [...new Set(wanted.map((w) => w.currency))].filter((c) => !got.has(c));
  if (missing.length > 0) throw new RatesUnavailableError(missing, offline);

  return (currency, day) => {
    const days = got.get(currency);
    if (!days) return undefined;
    const exact = days.find((d) => d.day === day);
    if (exact) return { rate: exact.rate, source: "fetched" };
    const at = Date.parse(`${day}T00:00:00Z`);
    const distance = (d: { day: string }) => Math.abs(Date.parse(`${d.day}T00:00:00Z`) - at);
    // Nearest, and the earlier of two as near: a rate already known on the day beats one from after it.
    const nearest = [...days].sort((a, b) => distance(a) - distance(b) || a.day.localeCompare(b.day))[0]!;
    return { rate: nearest.rate, source: "copied" };
  };
}
