import { isCurrencyCode, isValidRate, type Rate } from "@bida/core";

/**
 * Asking the Worker what a currency is worth today.
 *
 * One fetch, no retry, no poller and no prefetch of the whole currency list: a
 * trip is spent in one or two currencies, and the only thing that ever wants a
 * rate is a dialog somebody just opened. See `apps/api/src/index.ts` for the
 * feed behind the endpoint and why it sits behind one.
 *
 * What comes back is a *suggestion*. Nothing here writes to the log — the rate
 * moves every balance in the group, so it takes a tap on Save
 * ([ADR-0005](../../../docs/decisions/0005-money-and-currency.md)).
 */

export interface FetchedRate {
  rate: Rate;
  /** The feed's own date, "YYYY-MM-DD", or null when it didn't say. */
  asOf: string | null;
}

/** The phone can't reach anything. Said differently from a feed that has no answer. */
export class RateOfflineError extends Error {}

/** The endpoint answered, but with no rate for this pair. */
export class RateUnavailableError extends Error {}

export async function fetchRate(from: string, to: string): Promise<FetchedRate> {
  if (!isCurrencyCode(from) || !isCurrencyCode(to)) {
    throw new RateUnavailableError(`${from} to ${to} is not a pair`);
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new RateOfflineError("offline");
  }
  let res: Response;
  try {
    res = await fetch(`/api/rates/${encodeURIComponent(from)}/${encodeURIComponent(to)}`);
  } catch {
    // fetch only rejects when the request never reached a server — a captive
    // portal, a dropped connection — which is offline by another name.
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
