/**
 * Turns a model's reading of a receipt into an entry-draft patch. The model
 * does the reading — merchant, total, currency, date, category — and this
 * does no arithmetic or reformatting on top of it. See docs/receipt-scanning.md.
 *
 * Amounts and dates are trusted in the exact shape asked for in the prompt
 * (plain decimal notation; `YYYY-MM-DD`), so there's no separator-guessing or
 * multi-format parser to maintain here.
 */

import { isCurrencyCode } from "./money.js";

/** One printed line: what it's called, translated, and what it cost. */
export interface ScanLineItem {
  /** As printed, in the receipt's own language. */
  label: string;
  /** English translation, or null if `label` already is English. */
  labelEn: string | null;
  /** Plain decimal notation — same convention as ScanResult.total. */
  amount: string;
  /** The count printed for this line (e.g. "2x", a qty column), or null if none is printed — not inferred. */
  quantity: number | null;
}

export interface ScanResult {
  merchant: string | null;
  /** Plain decimal notation, e.g. "42.50" or "1234.50" — parseMinor()-ready. Not a number. */
  total: string | null;
  /** A separate tip or service charge line, same notation as `total`, or null if none. */
  tip: string | null;
  /** ISO 4217, or null if illegible. */
  currency: string | null;
  /** YYYY-MM-DD, or null if illegible. */
  date: string | null;
  /** One of the group's category names, or null. */
  category: string | null;
  /** Unused by normalizeScan today — the seam for restaurant splitting (product.md). */
  lineItems: ScanLineItem[];
  /**
   * A short, human-readable reason the model couldn't read a receipt out of
   * the photo (e.g. "This doesn't look like a receipt"), or null when it
   * read one. Set instead of guessing at the other fields — surfaced to the
   * person verbatim rather than a generic "couldn't read that".
   */
  error: string | null;
}

export interface ScanPatch {
  description?: string;
  /** Ready for parseMinor() with the chosen currency. */
  amountText?: string;
  currency?: string;
  occurredAt?: number;
  category?: string;
}

export function normalizeScan(result: ScanResult): ScanPatch {
  const patch: ScanPatch = {};
  if (result.merchant) patch.description = result.merchant;
  if (result.total) patch.amountText = result.total;
  // A currency only travels if it is three letters. Everything else the model
  // has been seen to return — a symbol, "EU", "USDT" — makes `formatMinor`
  // throw, and the form calls that on every render: adopting one white-screens
  // the screen you are typing on. Dropping it keeps the draft's own currency,
  // which is at worst the group's base and is at least formattable. It is a
  // drop rather than a repair for the same reason: "USDT" clipped to "USD"
  // would bank a number in a currency nobody named.
  if (result.currency) {
    const code = result.currency.trim().toUpperCase();
    if (isCurrencyCode(code)) patch.currency = code;
  }
  // Built in local time, not parsed as UTC midnight: `dateInputValue` and
  // `dayLabel` both read the instant back locally, so a UTC-midnight stamp
  // shows and files a receipt a day early anywhere west of Greenwich.
  if (result.date) {
    const [y, m, d] = result.date.split("-").map(Number);
    if (y && m && d) {
      const local = new Date(y, m - 1, d).getTime();
      if (!Number.isNaN(local)) patch.occurredAt = local;
    }
  }
  if (result.category) patch.category = result.category;
  return patch;
}
