/**
 * Turns a model's reading of a receipt into an entry-draft patch. The model
 * does the reading — merchant, total, currency, date — and this
 * does no arithmetic or reformatting on top of it. See docs/receipt-scanning.md.
 *
 * Amounts and dates are trusted in the exact shape asked for in the prompt
 * (plain decimal notation; `YYYY-MM-DD`), so there's no separator-guessing or
 * multi-format parser to maintain here.
 */

import { isCurrencyCode, parseMinor, type CurrencyCode } from "./money.js";

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
}

export function normalizeScan(result: ScanResult): ScanPatch {
  const patch: ScanPatch = {};
  if (result.merchant) patch.description = result.merchant;
  if (result.total) patch.amountText = result.total;
  const currency = readCurrency(result);
  if (currency) patch.currency = currency;
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
  return patch;
}

/**
 * The scan's own currency, or null.
 *
 * A currency only travels if it is three letters. Everything else the model
 * has been seen to return — a symbol, "EU", "USDT" — makes `formatMinor`
 * throw, and the form calls that on every render: adopting one white-screens
 * the screen you are typing on. Dropping it keeps the draft's own currency,
 * which is at worst the group's base and is at least formattable. It is a
 * drop rather than a repair for the same reason: "USDT" clipped to "USD"
 * would bank a number in a currency nobody named.
 */
function readCurrency(result: ScanResult): CurrencyCode | null {
  const code = result.currency?.trim().toUpperCase();
  return code && isCurrencyCode(code) ? code : null;
}

/** What a scan is counted in: its own currency when it has a usable one, else the draft's. */
export function scanCurrency(result: ScanResult, fallback: CurrencyCode): CurrencyCode {
  return readCurrency(result) ?? fallback;
}

/** Why a reading can't be trusted, when the model itself didn't object to the photo. */
export type ScanProblem = "no-total" | "unreadable-line" | "credit-line" | "mismatch";

/**
 * Does this reading hold together? `null` when it does.
 *
 * The bar is arithmetic, not judgement, and it is absolute: every line
 * readable, nothing given back, and the lines plus the tip equal to the
 * printed total, to the minor unit. A scan the app can't reconcile is a scan
 * that failed — importing one prices everybody in the who-had-what grid
 * against a total the receipt never printed, silently, on a bill nobody
 * re-reads. Refusing costs one more photo; accepting costs somebody money.
 */
export function checkScan(result: ScanResult, currency: CurrencyCode): ScanProblem | null {
  const total = readAmount(result.total, currency);
  if (total === null) return "no-total";

  let sum = 0;
  for (const item of result.lineItems) {
    const minor = readAmount(item.amount, currency);
    if (minor === null) return "unreadable-line";
    // A discount or a returned item sums into the total but takes no part in
    // the grid's ratios, so it would be shared out across everybody rather
    // than landing where it was earned. Refused until the grid can say who a
    // credit belongs to — an open question in docs/product.md.
    if (minor < 0) return "credit-line";
    sum += minor;
  }
  if (result.tip) {
    const tip = readAmount(result.tip, currency);
    if (tip === null) return "unreadable-line";
    if (tip < 0) return "credit-line";
    sum += tip;
  }

  // Legible and still not a bill. It lands here rather than in "no-total"
  // because the number was read fine; what it says is the problem.
  if (total <= 0) return "mismatch";
  // Nothing to reconcile when no lines were printed — a receipt that is just
  // a total is an ordinary expense, and the grid never opens on it.
  if (result.lineItems.length === 0) return null;
  return sum === total ? null : "mismatch";
}

function readAmount(text: string | null, currency: CurrencyCode): number | null {
  if (!text) return null;
  try {
    return parseMinor(text, currency);
  } catch {
    return null;
  }
}
