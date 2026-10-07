import { isCurrencyCode, isValidRate, type Rate } from "@bida/core";

/**
 * Asking the Worker what a currency was worth on an entry's day.
 *
 * One fetch, no retry, no poller and no prefetch of the whole currency list:
 * the only thing that wants a rate is an entry form whose currency or day just
 * changed, or the rate dialog. See `apps/api/src/index.ts` for the feed behind
 * the endpoint and why it sits behind one.
 *
 * Nothing here writes to the log: the rate rides on the entry, saved with it
 * ([ADR-0005](../../../docs/decisions/0005-money-and-currency.md)).
 */

interface FetchedRate {
  rate: Rate;
  /** The feed's own date, "YYYY-MM-DD", or null when it didn't say. */
  asOf: string | null;
}

/** The phone can't reach anything. Said differently from a feed that has no answer. */
export class RateOfflineError extends Error {}

/** The endpoint answered, but with no rate for this pair. */
class RateUnavailableError extends Error {}

/** Past this, the form stops waiting and borrows the group's last rate instead. */
const PATIENCE_MS = 6000;

/** `day` is the entry's local "YYYY-MM-DD"; the Worker answers today's for today or later. */
export async function fetchRate(from: string, to: string, day?: string): Promise<FetchedRate> {
  if (!isCurrencyCode(from) || !isCurrencyCode(to)) {
    throw new RateUnavailableError(`${from} to ${to} is not a pair`);
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new RateOfflineError("offline");
  }
  let res: Response;
  try {
    const query = day ? `?date=${encodeURIComponent(day)}` : "";
    res = await fetch(`/api/rates/${encodeURIComponent(from)}/${encodeURIComponent(to)}${query}`,
      { signal: AbortSignal.timeout(PATIENCE_MS) });
  } catch {
    // fetch only rejects when the request never reached a server — a captive
    // portal, a dropped connection, a signal too weak to finish in time —
    // which is offline by another name.
    throw new RateOfflineError("unreachable");
  }
  if (!res.ok) throw new RateUnavailableError(`rates endpoint answered ${res.status}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new RateUnavailableError("rates endpoint answered with something that isn't JSON");
  }
  const payload = body as { rate?: unknown; asOf?: unknown };
  if (typeof payload.rate !== "string" || !isValidRate(payload.rate)) {
    throw new RateUnavailableError(`no rate for ${from} to ${to}`);
  }
  return {
    rate: payload.rate,
    asOf: typeof payload.asOf === "string" ? payload.asOf : null,
  };
}
