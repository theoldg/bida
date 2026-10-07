"use client";

import { useEffect, useRef, useState } from "react";
import { isValidRate, type CurrencyCode, type EntryRateSource, type Rate } from "@bida/core";
import { getDraft, saveDraft, type EntryDraft } from "./draft";
import { dateInputValue } from "./format";
import { fetchRate } from "./rates";

/**
 * An entry's own rate, found while the form is open (ADR-0005): the feed's
 * for the entry's day; failing that, the rate it already had; failing that,
 * the group's most recent entry in the currency (`latestRate`). Only a
 * currency new to the group with the feed out of reach opens the rate dialog.
 *
 * The rate lives on the draft, so it is saved with the entry and nothing is
 * written until Save.
 */

/** The day an entry's rate is for: its own local day, as the feed names them. */
export function rateDayOf(occurredAt: number): string {
  return dateInputValue(occurredAt);
}

/**
 * Does the draft need the feed? When it is foreign and its rate is for
 * another currency, or none, or for another day — a day only if nobody typed
 * the rate, since a typed one is a person's answer for the entry as a whole.
 * A scan clears `rateDay`, so it always looks again.
 */
export function rateLookupWanted(draft: EntryDraft, base: CurrencyCode): boolean {
  if (draft.currency === base) return false;
  if (draft.rateCurrency !== draft.currency || draft.rateDay === undefined) return true;
  return draft.rateDay !== rateDayOf(draft.occurredAt) && draft.rateSource !== "typed";
}

/** What a look-up settled on, or null for "ask". */
export function settleRate(
  latest: EntryDraft,
  currency: CurrencyCode,
  fetched: Rate | null,
  borrow: (currency: CurrencyCode) => Rate | undefined,
): { rate: Rate; rateSource: EntryRateSource } | null {
  if (fetched !== null) return { rate: fetched, rateSource: "fetched" };
  // A rate the entry already holds for this currency beats somebody else's.
  if (latest.rateCurrency === currency && latest.rate !== undefined && isValidRate(latest.rate)) {
    return { rate: latest.rate, rateSource: latest.rateSource ?? "group" };
  }
  const borrowed = borrow(currency);
  return borrowed !== undefined ? { rate: borrowed, rateSource: "copied" } : null;
}

/**
 * Runs the look-up whenever `rateLookupWanted` says so. `looking` is true
 * while the feed is asked; `ask` names the currency the dialog should open
 * for, set only when everything failed.
 */
export function useEntryRate(
  groupId: string,
  draft: EntryDraft,
  base: CurrencyCode,
  borrow: (currency: CurrencyCode) => Rate | undefined,
): { looking: boolean; ask: CurrencyCode | null; setAsk: (currency: CurrencyCode | null) => void } {
  const [inFlight, setInFlight] = useState<string | null>(null);
  const [ask, setAsk] = useState<CurrencyCode | null>(null);
  const borrowRef = useRef(borrow);
  borrowRef.current = borrow;

  const day = rateDayOf(draft.occurredAt);
  const want = rateLookupWanted(draft, base) ? `${draft.currency} ${day}` : null;

  useEffect(() => {
    if (!want) return;
    const [currency, wantedDay] = want.split(" ") as [string, string];
    let live = true;
    setInFlight(want);
    void fetchRate(currency, base, wantedDay)
      .then((got) => got.rate, () => null)
      .then((fetched) => {
        if (!live) return;
        setInFlight(null);
        const latest = getDraft(groupId);
        // Moved on while the feed was asked: the effect has asked again. (A rate
        // typed meanwhile settles the look-up, and the cleanup drops this one.)
        if (!latest || latest.currency !== currency || rateDayOf(latest.occurredAt) !== wantedDay) return;
        const found = settleRate(latest, currency, fetched, borrowRef.current);
        saveDraft(groupId, {
          ...latest,
          rateCurrency: currency,
          rateDay: wantedDay,
          rate: found?.rate,
          rateSource: found?.rateSource,
        });
        if (!found) setAsk(currency);
      });
    return () => { live = false; };
  }, [want, base, groupId]);

  return { looking: want !== null && inFlight === want, ask, setAsk };
}
