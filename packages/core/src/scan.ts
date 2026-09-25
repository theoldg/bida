/**
 * A model's reading of a receipt, turned into an entry-draft patch. No
 * arithmetic or reformatting on top: the prompt fixes the shapes (plain
 * decimal, `YYYY-MM-DD`). docs/scan-reading.md.
 */

import { isCurrencyCode, minorToDecimalString, parseMinor, type CurrencyCode } from "./money.js";
import type { ScanMedium } from "./scan-body.js";
import type { ReceiptDiscount } from "./types.js";
import { sameLocalDay } from "./when.js";

/**
 * One bill line as the model returns it. Exactly one cost is filled: the
 * printed line total (`amount`), or a typed price-of-one (`unitAmount` plus
 * `quantity`). Asking for a figure the bill doesn't hold makes the model
 * invent one, so `lineMinor` multiplies.
 */
export interface ScanLineItem {
  /** As written, in the bill's own language. */
  label: string;
  /** English translation, or null if `label` already is English. */
  labelEn: string | null;
  /** What the whole line came to, when the bill gives that. Plain decimal, same convention as ScanResult.total. */
  amount: string | null;
  /** The price of one, when that is what the bill gives instead. Same notation; needs `quantity` to mean anything. */
  unitAmount: string | null;
  /** The count the bill states for this line ("2x", a qty column), or null if none is stated — not inferred. */
  quantity: number | null;
}

/** A line with its figure resolved, whichever way the bill wrote it. */
export interface BillItem {
  label: string;
  labelEn: string | null;
  /** Always the whole line — `unitAmount` times the count where that is what the bill gave. */
  amount: string;
  quantity: number | null;
}

/** One deduction, as the receipt printed it. `amount` is what comes off, written positive. */
export interface ScanDiscount {
  label: string;
  /** English translation, or null if `label` already is English. */
  labelEn: string | null;
  amount: string;
}

export interface ScanResult {
  /**
   * What to call the expense: the merchant's name without the legal suffix
   * ("Bar Zahra"), plus what was bought if the name alone wouldn't say
   * ("Lidl - barbecue"). Null when no name is legible.
   */
  title: string | null;
  /** Plain decimal notation, e.g. "42.50" or "1234.50" — parseMinor()-ready. Not a number. */
  total: string | null;
  /** A separate tip or service charge line, same notation as `total`, or null if none. */
  tip: string | null;
  /** Tax charged on top of the printed lines — never VAT already inside them. Same notation, or null. */
  tax: string | null;
  /** Every deduction the bill printed, one entry each. Empty when it takes nothing off. */
  discounts: ScanDiscount[];
  /** ISO 4217, or null if illegible. */
  currency: string | null;
  /** YYYY-MM-DD, or null if illegible. */
  date: string | null;
  /** Every line the bill lists. `readBill` resolves each one's figure. */
  lineItems: ScanLineItem[];
  /**
   * The bill is written in English, which clears every `labelEn` in `readBill`:
   * asked line by line, the model "translates" an English bill's shorthand
   * ("Chkn wrap" → "Chicken wrap") and the translate toggle turns up on it.
   */
  english: boolean;
  /**
   * Why the model couldn't read a receipt ("This doesn't look like a receipt"),
   * shown verbatim; null when it did. Set instead of guessing the other fields.
   */
  error: string | null;
}

export interface ScanPatch {
  description?: string;
  /** Ready for parseMinor() with the chosen currency. */
  amountText?: string;
  currency?: string;
  /** The moment of the scan for a receipt printed today; local midnight for any other day. */
  occurredAt?: number;
  /** True when `occurredAt` is a day and nothing more — a receipt prints no hour. */
  dateOnly?: boolean;
}

/**
 * A receipt printed today takes `now` as its stamp; any other day takes local
 * midnight and `dateOnly`, since the hour isn't on it. `currency` is for a
 * bill with no total, whose summed amount must be written in the draft's.
 */
export function normalizeScan(result: ScanResult, currency: CurrencyCode, now: number): ScanPatch {
  const patch: ScanPatch = {};
  if (result.title) patch.description = result.title;
  if (result.total) {
    // Already in the prompt's notation; re-rendering it would be an opinion.
    patch.amountText = result.total;
  } else {
    const minor = billTotalMinor(result, currency);
    if (minor !== null) patch.amountText = minorToDecimalString(minor, currency);
  }
  const scanned = readCurrency(result);
  if (scanned) patch.currency = scanned;
  // Local time, not UTC midnight: the screens read it locally, so UTC midnight
  // files a receipt a day early west of Greenwich.
  if (result.date) {
    const [y, m, d] = result.date.split("-").map(Number);
    if (y && m && d) {
      const local = new Date(y, m - 1, d).getTime();
      if (!Number.isNaN(local)) {
        const printedToday = sameLocalDay(local, now);
        patch.occurredAt = printedToday ? now : local;
        patch.dateOnly = !printedToday;
      }
    }
  }
  return patch;
}

/**
 * The scan's own currency, or null. Only three letters are accepted: anything
 * else makes `formatMinor` throw on every render. Dropped, never repaired —
 * "USDT" clipped to "USD" banks money in a currency nobody named.
 */
function readCurrency(result: ScanResult): CurrencyCode | null {
  const code = result.currency?.trim().toUpperCase();
  return code && isCurrencyCode(code) ? code : null;
}

/** What a scan is counted in: its own currency when it has a usable one, else the draft's. */
export function scanCurrency(result: ScanResult, fallback: CurrencyCode): CurrencyCode {
  return readCurrency(result) ?? fallback;
}

/**
 * What a bill charges that nobody ordered: tip, tax on top, deductions. All
 * divide in proportion to what each person ordered. All positive magnitudes;
 * the sign is applied in `receiptBreakdown` only (docs/data-model.md#money).
 */
export interface BillExtras {
  tip: string | null;
  tax: string | null;
  /** Kept apart, not summed, so the grid can name each deduction. */
  discounts: ReceiptDiscount[];
}

/** The extras in the order a printed bill rules them off under the items. */
const EXTRAS = ["discount", "tax", "tip"] as const;
export type ExtraKind = (typeof EXTRAS)[number];

/** A bill the app can work with: positive lines, and the extras beside them. */
interface Bill {
  items: BillItem[];
  extras: BillExtras;
}

/**
 * One line in minor units, whichever way the bill stated it — the only
 * multiplication in the reading. `amount` wins when both are filled; null
 * (no usable figure) is `checkScan`'s `unreadable-line`.
 */
export function lineMinor(item: ScanLineItem, currency: CurrencyCode): number | null {
  const whole = readAmount(item.amount, currency);
  if (whole !== null) return whole;

  const unit = readAmount(item.unitAmount, currency);
  const count = item.quantity;
  // A unit price without a count prices nothing; taking it as the line total
  // would charge three skewers as one.
  if (unit === null || count === null || !Number.isInteger(count) || count <= 0) return null;
  const minor = unit * count;
  // `parseMinor` guards its own range; the product needs this.
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * A reading with every deduction pooled. Receipts put discounts anywhere and
 * the model files them inconsistently, so every negative amount joins the
 * pool: items all positive, one figure off the lot. Pooling is what makes a
 * discount proportional (ADR-0016).
 */
export function readBill(result: ScanResult, currency: CurrencyCode): Bill {
  const discounts: ReceiptDiscount[] = [];
  /** Keeps a positive extra; a negative one is a deduction and joins the list. */
  const keep = (text: string | null, label: string): string | null => {
    const minor = readAmount(text, currency);
    if (minor === null || minor >= 0) return text;
    discounts.push({ label, amount: minorToDecimalString(-minor, currency) });
    return null;
  };

  /** No English for a bill already in English, whatever the lines came back with. */
  const en = (labelEn: string | null) => (result.english ? null : labelEn);

  const tip = keep(result.tip, "");
  const tax = keep(result.tax, "");
  const items: BillItem[] = [];
  for (const item of result.lineItems) {
    const minor = lineMinor(item, currency);
    if (minor !== null && minor < 0) {
      discounts.push({
        label: item.label, labelEn: en(item.labelEn), amount: minorToDecimalString(-minor, currency),
      });
      continue;
    }
    items.push({
      label: item.label,
      labelEn: en(item.labelEn),
      // A line priced outright keeps the model's own string, unreadable or not,
      // for `checkScan` to refuse. No usable figure becomes "" (unreadable).
      amount: item.amount ?? (minor === null ? "" : minorToDecimalString(minor, currency)),
      quantity: item.quantity,
    });
  }
  for (const printed of result.discounts) {
    const minor = readAmount(printed.amount, currency);
    // `Math.abs`: the model sometimes echoes the printed minus, which would turn
    // a deduction into a surcharge.
    if (minor === null || minor === 0) continue;
    discounts.push({
      label: printed.label,
      labelEn: en(printed.labelEn),
      amount: minorToDecimalString(Math.abs(minor), currency),
    });
  }

  return { items, extras: { tip, tax, discounts } };
}

/** The extras' net effect on a total: what is added, less what comes off. Null if any is illegible. */
export function extrasMinor(extras: BillExtras, currency: CurrencyCode): number | null {
  let net = 0;
  for (const text of [extras.tip, extras.tax]) {
    if (!text) continue;
    const minor = readAmount(text, currency);
    if (minor === null) return null;
    net += minor;
  }
  for (const off of extras.discounts) {
    const minor = readAmount(off.amount, currency);
    if (minor === null) return null;
    net -= minor;
  }
  return net;
}

/** The extras as an entry keeps them — three flat fields on `Expense` and on the draft. */
export function receiptExtras(source: {
  receiptTip?: string | null;
  receiptTax?: string | null;
  receiptDiscounts?: ReceiptDiscount[] | null;
}): BillExtras {
  return {
    tip: source.receiptTip ?? null,
    tax: source.receiptTax ?? null,
    discounts: source.receiptDiscounts ?? [],
  };
}

/** Why a reading can't be trusted, when the model itself didn't object to the bill. */
export type ScanProblem = "no-total" | "unreadable-line" | "mismatch";

/** The bill's own lines and extras added up, or null if any figure is unreadable. */
function sumBill(result: ScanResult, currency: CurrencyCode): number | null {
  const bill = readBill(result, currency);
  let sum = 0;
  for (const item of bill.items) {
    const minor = readAmount(item.amount, currency);
    if (minor === null) return null;
    sum += minor;
  }
  const extras = extrasMinor(bill.extras, currency);
  return extras === null ? null : sum + extras;
}

/** Did the bill itself state a total, as opposed to us being able to work one out? */
function statesTotal(result: ScanResult): boolean {
  return (result.total ?? "").trim().length > 0;
}

/** The stated total, else lines and extras summed; null when neither. */
export function billTotalMinor(result: ScanResult, currency: CurrencyCode): number | null {
  const stated = readAmount(result.total, currency);
  if (stated !== null) return stated;
  return result.lineItems.length === 0 ? null : sumBill(result, currency);
}

/**
 * Does this reading hold together? `null` when it does: every figure readable,
 * and lines + tip + tax − discounts equal to the total. A refusal costs one more
 * photo; accepting prices the grid against a wrong total.
 *
 * Only a stated total is reconciled against. A photo with none is cropped; a
 * typed bill usually has none, and its lines are the bill
 * (docs/scan-reading.md#what-a-reading-is-checked-against).
 */
export function checkScan(
  result: ScanResult,
  currency: CurrencyCode,
  /** A photograph unless said otherwise — the original act, and the strict one. */
  medium: ScanMedium = "photo",
): ScanProblem | null {
  const stated = statesTotal(result);
  const total = readAmount(result.total, currency);
  // A figure that is there and won't parse is a failed reading in any medium.
  if (stated && total === null) return "no-total";
  // Absent means cropped on a photo; fine on a typed bill with lines.
  if (!stated && (medium === "photo" || result.lineItems.length === 0)) return "no-total";

  // Before `readBill`, which takes an illegible figure as nothing — a discount
  // silently worth zero is the error to catch.
  for (const text of [result.tip, result.tax, ...result.discounts.map((d) => d.amount)]) {
    if (text && readAmount(text, currency) === null) return "unreadable-line";
  }

  const sum = sumBill(result, currency);
  if (sum === null) return "unreadable-line";

  // No total: the lines are the bill; just check they come to something.
  if (total === null) return sum > 0 ? null : "mismatch";

  // Includes a discount bigger than what it comes off.
  if (total <= 0) return "mismatch";
  // A receipt that is just a total is an ordinary expense.
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

/**
 * The scan budget, shared so the phone refuses instantly and the Worker
 * enforces the same numbers. docs/scan-worker.md#what-the-scan-costs.
 */
export const SCAN_LIMITS = {
  /** The `:id` a scan is billed to — a group, shared by everyone in it, or one phone's credential. */
  caller: { hour: 10, day: 30 },
  /** One address, HMAC'd server-side. Loose enough for a table of friends on one restaurant wifi. */
  client: { hour: 20, day: 50 },
  /** The bill. The only bucket nothing can be minted around; the hourly sub-cap keeps a burst from eating the day. */
  global: { hour: 700, day: 4300 },
} as const;

/** Which bucket a refusal came out of. The phone prints a different sentence for each. */
export type ScanLimitScope = keyof typeof SCAN_LIMITS;

/**
 * The longest typed-in bill. ~4,000 chars costs about what the downscaled
 * photo does, so typing is never dearer; a sixty-line till roll is ~1,800.
 * The Worker's `MAX_TEXT_BYTES` is a looser abuse ceiling.
 */
export const BILL_TEXT_MAX = 4000;

