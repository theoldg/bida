/**
 * A model's reading of a receipt, turned into an entry-draft patch. No arithmetic
 * or reformatting on top: the prompt fixes the shapes.
 */

import { isCurrencyCode, minorToDecimalString, parseMinor, type CurrencyCode } from "./money";
import type { Receipt, ReceiptExtra } from "./types";
import { sameLocalDay } from "./when";

/**
 * A line fills one cost — the line total, or a unit price and `quantity` —
 * since asking for a figure the bill doesn't hold makes the model invent one.
 */
export interface ScanLineItem {
  label: string;
  labelEn: string | null;
  amount: string | null;
  unitAmount: string | null;
  /** As stated, never inferred. */
  quantity: number | null;
}

export interface BillItem {
  label: string;
  labelEn: string | null;
  amount: string;
  quantity: number | null;
}

/** A charge or a deduction; `amount` is written positive either way. */
export interface ScanExtra {
  label: string;
  labelEn: string | null;
  amount: string;
}

export interface ScanResult {
  /**
   * The merchant without the legal suffix, plus what was bought if the name alone
   * wouldn't say ("Lidl - barbecue").
   */
  title: string | null;
  /** Plain decimal, parseMinor()-ready. Not a number. */
  total: string | null;
  /**
   * Written after the total, so outside it: a tip somebody already decided. One
   * printed above the total is a charge.
   */
  tip: string | null;
  /** What the bill adds on top of the lines — never VAT already inside them. */
  charges: ScanExtra[];
  discounts: ScanExtra[];
  currency: string | null;
  date: string | null;
  lineItems: ScanLineItem[];
  /**
   * Clears every `labelEn`: asked line by line, the model "translates" an English
   * bill's shorthand.
   */
  english: boolean;
  /** Shown verbatim; set instead of guessing the other fields. */
  error: string | null;
}

export interface ScanPatch {
  description?: string;
  amountText?: string;
  currency?: string;
  occurredAt?: number;
  dateOnly?: boolean;
}

/** Today's receipt takes `now`; any other day local midnight and `dateOnly`. */
export function normalizeScan(result: ScanResult, currency: CurrencyCode, now: number): ScanPatch {
  const patch: ScanPatch = {};
  if (result.title) patch.description = result.title;
  const tip = tipMinor(result, currency);
  if (result.total && tip === null) {
    // Re-rendering the prompt's notation would be an opinion.
    patch.amountText = result.total;
  } else {
    // What was paid: the total, and the tip written after it.
    const minor = billTotalMinor(result, currency);
    if (minor !== null) patch.amountText = minorToDecimalString(minor + (tip ?? 0), currency);
  }
  const scanned = readCurrency(result);
  if (scanned) patch.currency = scanned;
  // Local time: UTC midnight files a receipt a day early west of Greenwich.
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
 * Dropped, never repaired — "USDT" clipped to "USD" banks money in a currency
 * nobody named.
 */
function readCurrency(result: ScanResult): CurrencyCode | null {
  const code = result.currency?.trim().toUpperCase();
  return code && isCurrencyCode(code) ? code : null;
}

export function scanCurrency(result: ScanResult, fallback: CurrencyCode): CurrencyCode {
  return readCurrency(result) ?? fallback;
}

/** All positive magnitudes; the sign is applied in `receiptBreakdown` only. */
export interface BillExtras {
  /** Typed, or a tip the bill shows written after its total. */
  tip: string | null;
  /** Kept apart so the bill can name each one. */
  charges: ReceiptExtra[];
  discounts: ReceiptExtra[];
}

/** The order a printed bill rules them off under the items. */
const EXTRAS = ["discount", "charge", "tip"] as const;
export type ExtraKind = (typeof EXTRAS)[number];

export interface Bill {
  items: BillItem[];
  extras: BillExtras;
}

/** The only multiplication in the reading; `amount` wins when both are filled. */
export function lineMinor(item: ScanLineItem, currency: CurrencyCode): number | null {
  const whole = readAmount(item.amount, currency);
  if (whole !== null) return whole;

  const unit = readAmount(item.unitAmount, currency);
  const count = item.quantity;
  // A unit price without a count prices nothing.
  if (unit === null || count === null || !Number.isInteger(count) || count <= 0) return null;
  const minor = unit * count;
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * Every negative amount joins one pool, wherever the model filed it: pooling is
 * what makes a discount proportional (ADR-0016).
 */
export function readBill(result: ScanResult, currency: CurrencyCode): Bill {
  const discounts: ReceiptExtra[] = [];
  const charges: ReceiptExtra[] = [];
  const en = (labelEn: string | null) => (result.english ? null : labelEn);

  for (const printed of result.charges) {
    const minor = readAmount(printed.amount, currency);
    if (minor === null || minor === 0) continue;
    (minor < 0 ? discounts : charges).push({
      label: printed.label, labelEn: en(printed.labelEn), amount: minorToDecimalString(Math.abs(minor), currency),
    });
  }
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
      // Keeps the model's own string, for `checkScan` to refuse.
      amount: item.amount ?? (minor === null ? "" : minorToDecimalString(minor, currency)),
      quantity: item.quantity,
    });
  }
  for (const printed of result.discounts) {
    const minor = readAmount(printed.amount, currency);
    // `Math.abs`: the model sometimes echoes the printed minus.
    if (minor === null || minor === 0) continue;
    discounts.push({
      label: printed.label,
      labelEn: en(printed.labelEn),
      amount: minorToDecimalString(Math.abs(minor), currency),
    });
  }

  const tip = tipMinor(result, currency);
  return { items, extras: { tip: tip === null ? null : minorToDecimalString(tip, currency), charges, discounts } };
}

/** Null unless readable and positive: a tip of nothing is no tip. */
function tipMinor(result: ScanResult, currency: CurrencyCode): number | null {
  const minor = readAmount(result.tip, currency);
  return minor !== null && minor > 0 ? minor : null;
}

export function extrasMinor(extras: BillExtras, currency: CurrencyCode): number | null {
  let net = 0;
  for (const text of [extras.tip, ...extras.charges.map((c) => c.amount)]) {
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

export function receiptExtras(source: Receipt): BillExtras {
  return {
    tip: source.receiptTip ?? null,
    // Unnamed: the label is the bill's word, and that bill printed none.
    charges: [...(source.receiptTax ? [{ label: "", amount: source.receiptTax }] : []), ...source.receiptCharges ?? []],
    discounts: source.receiptDiscounts ?? [],
  };
}

/** `receiptOf({})` is no bill at all. */
export function receiptOf(source: Receipt): { [K in keyof Receipt]-?: NonNullable<Receipt[K]> | null } {
  return {
    receiptItems: source.receiptItems ?? null,
    receiptTip: source.receiptTip ?? null,
    receiptTax: source.receiptTax ?? null,
    receiptCharges: source.receiptCharges ?? null,
    receiptDiscounts: source.receiptDiscounts ?? null,
    receiptInvolved: source.receiptInvolved ?? null,
    receiptAssignments: source.receiptAssignments ?? null,
    receiptText: source.receiptText ?? null,
    receiptEnglish: source.receiptEnglish === true ? true : null,
  };
}

export type ScanProblem = "no-total" | "unreadable-line" | "mismatch";

/** Lines, charges and discounts: what the printed total covers, so never the tip after it. */
function sumBill(result: ScanResult, currency: CurrencyCode): number | null {
  const bill = readBill(result, currency);
  let sum = 0;
  for (const item of bill.items) {
    const minor = readAmount(item.amount, currency);
    if (minor === null) return null;
    sum += minor;
  }
  const extras = extrasMinor({ ...bill.extras, tip: null }, currency);
  return extras === null ? null : sum + extras;
}

/**
 * One line's printed total swapped for count × unit price, when that alone makes
 * the bill come to its total (docs/scan-reading.md#one-faded-figure). One line,
 * never a combination; a bill that already adds up is never touched.
 */
export function correctOneLine(result: ScanResult, currency: CurrencyCode): ScanResult {
  const total = readAmount(result.total, currency);
  const sum = sumBill(result, currency);
  if (total === null || sum === null || sum === total) return result;

  let found: ScanResult | null = null;
  for (const [i, item] of result.lineItems.entries()) {
    const printed = readAmount(item.amount, currency);
    const unit = readAmount(item.unitAmount, currency);
    const count = item.quantity;
    if (printed === null || printed <= 0 || unit === null || unit <= 0) continue;
    if (count === null || !Number.isInteger(count) || count <= 0) continue;
    const product = unit * count;
    if (!Number.isSafeInteger(product) || product === printed) continue;
    const fixed: ScanResult = {
      ...result,
      lineItems: result.lineItems.map((li, j) => (
        j === i ? { ...li, amount: minorToDecimalString(product, currency) } : li
      )),
    };
    if (sumBill(fixed, currency) !== total) continue;
    if (found) return result;
    found = fixed;
  }
  return found ?? result;
}

function statesTotal(result: ScanResult): boolean {
  return (result.total ?? "").trim().length > 0;
}

export function billTotalMinor(result: ScanResult, currency: CurrencyCode): number | null {
  const stated = readAmount(result.total, currency);
  if (stated !== null) return stated;
  return result.lineItems.length === 0 ? null : sumBill(result, currency);
}

/**
 * A refusal costs one more photo; accepting prices the grid against a wrong
 * total. Only a stated total is reconciled against.
 */
export function checkScan(
  result: ScanResult,
  currency: CurrencyCode,
): ScanProblem | null {
  const total = statesTotal(result) ? readAmount(result.total, currency) : null;
  if (total === null) return "no-total";

  // Before `readBill`, which takes an illegible figure as nothing.
  for (const text of [...result.charges, ...result.discounts].map((x) => x.amount)) {
    if (text && readAmount(text, currency) === null) return "unreadable-line";
  }

  const sum = sumBill(result, currency);
  if (sum === null) return "unreadable-line";

  // Includes a discount bigger than what it comes off.
  if (total <= 0) return "mismatch";
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
 * Shared, so the phone refuses instantly and the Worker enforces the same
 * numbers.
 */
export const SCAN_LIMITS = {
  /** The `:id` billed — a group, or one phone's credential. */
  caller: { hour: 10, day: 30 },
  /** One address, HMAC'd. Loose enough for friends on one restaurant wifi. */
  client: { hour: 20, day: 50 },
  /** The only bucket nothing can be minted around. */
  global: { hour: 700, day: 4300 },
} as const;

export type ScanLimitScope = keyof typeof SCAN_LIMITS;

/** The phone aims well under it, so hitting it means a caller that isn't ours. */
export const MAX_IMAGE_BYTES = 400_000;

