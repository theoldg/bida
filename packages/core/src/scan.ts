/**
 * Turns a model's reading of a receipt into an ExpenseDraft patch. The model
 * does the reading — merchant, total, currency, date, category — and this
 * does no arithmetic on top of it. See docs/receipt-scanning.md.
 *
 * Dates are trusted as printed (`YYYY-MM-DD`): the model is asked for that
 * shape directly, so there's no multi-format date parser to maintain here.
 */

/** One printed line: what it's called, translated, and what it cost. */
export interface ScanLineItem {
  /** As printed, in the receipt's own language. */
  label: string;
  /** English translation, or null if `label` already is English. */
  labelEn: string | null;
  /** The amount exactly as printed — same convention as ScanResult.total. */
  amount: string;
  /** The count printed for this line (e.g. "2x", a qty column), or null if none is printed — not inferred. */
  quantity: number | null;
}

export interface ScanResult {
  merchant: string | null;
  /** The total exactly as printed, e.g. "42,50" or "1.234,50". Not a number. */
  total: string | null;
  /** A separate tip or service charge line, printed as-is, or null if none. */
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

/**
 * Cleans a printed total into the shape parseMinor() accepts. The last "."
 * or "," is the decimal point only when 1–2 digits follow it (cents); any
 * separator before that, and any separator followed by 3+ digits, is a
 * thousands mark and gets dropped.
 *
 * Exported for callers who need the same cleanup on a printed amount that
 * isn't the receipt total — a line item, e.g. — without re-deriving it.
 */
export function cleanAmountText(total: string): string {
  const trimmed = total.replace(/[^\d,.-]/g, "");
  const neg = trimmed.startsWith("-") ? "-" : "";
  const body = trimmed.slice(neg.length);
  const lastSep = Math.max(body.lastIndexOf(","), body.lastIndexOf("."));
  if (lastSep === -1) return neg + body;
  const whole = body.slice(0, lastSep).replace(/[,.]/g, "");
  const frac = body.slice(lastSep + 1).replace(/[,.]/g, "");
  return frac.length > 0 && frac.length <= 2 ? `${neg}${whole}.${frac}` : `${neg}${whole}${frac}`;
}

export function normalizeScan(result: ScanResult): ScanPatch {
  const patch: ScanPatch = {};
  if (result.merchant) patch.description = result.merchant;
  if (result.total) patch.amountText = cleanAmountText(result.total);
  if (result.currency) patch.currency = result.currency.toUpperCase();
  if (result.date) {
    const parsed = Date.parse(`${result.date}T00:00:00Z`);
    if (!Number.isNaN(parsed)) patch.occurredAt = parsed;
  }
  if (result.category) patch.category = result.category;
  return patch;
}
