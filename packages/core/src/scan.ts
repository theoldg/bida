/**
 * A model's reading of a receipt, turned into an entry-draft patch. The model
 * reads; this adds no arithmetic or reformatting on top. Amounts and dates
 * arrive in the exact shape the prompt asked for (plain decimal, `YYYY-MM-DD`),
 * so there is no separator-guessing here. docs/receipt-scanning.md.
 */

import { isCurrencyCode, minorToDecimalString, parseMinor, type CurrencyCode } from "./money.js";
import type { ScanMedium } from "./scan-body.js";
import type { ReceiptDiscount } from "./types.js";
import { sameLocalDay } from "./when.js";

/**
 * One line of a bill, as the model returns it.
 *
 * **The cost arrives one of two ways and only one is filled.** A till prints
 * the extension (`amount`); somebody typing writes the price of one — "3
 * chicken at 13 each" — and the 39 is nowhere on the page (`unitAmount` plus
 * `quantity`). Asking the model for a figure the bill doesn't hold is what
 * makes it invent one, so `lineMinor` does the multiplying, in minor units.
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

/**
 * One line the app can price, its figure resolved whichever way the bill wrote
 * it — so nothing downstream of `readBill` knows a per-unit price was possible.
 */
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
   * What to call the expense: the merchant's name with the parts that aren't
   * the name stripped ("Bar Zahra - Sarl M. Benali" → "Bar Zahra"), and a few
   * words of what was bought when the name alone wouldn't say ("Lidl -
   * barbecue"). The model's judgement, asked for in the prompt — null when no
   * name is legible.
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
  /** The moment of the scan for a receipt printed today; local midnight for any other day. */
  occurredAt?: number;
  /** True when `occurredAt` is a day and nothing more — a receipt prints no hour. */
  dateOnly?: boolean;
}

/**
 * `now` is the moment of the scan, and a receipt printed today takes it as its
 * stamp — a real time of day, close enough. Any other day takes local midnight
 * and `dateOnly`: the hour is not on the receipt and the ledger will not
 * pretend the purchase happened at 00:00.
 *
 * `currency` (`scanCurrency(result, draft.currency)`) is needed for one case:
 * a bill stating no total, where the amount is summed from the lines and has
 * to be written in whatever the draft is about to hold.
 */
export function normalizeScan(result: ScanResult, currency: CurrencyCode, now: number): ScanPatch {
  const patch: ScanPatch = {};
  if (result.title) patch.description = result.title;
  if (result.total) {
    // Untouched: already in the notation the prompt asked for, and
    // re-rendering it is an opinion about a figure this didn't compute.
    patch.amountText = result.total;
  } else {
    const minor = billTotalMinor(result, currency);
    if (minor !== null) patch.amountText = minorToDecimalString(minor, currency);
  }
  const scanned = readCurrency(result);
  if (scanned) patch.currency = scanned;
  // Built in local time, not parsed as UTC midnight: `dateInputValue` and
  // `dayLabel` both read the instant back locally, so a UTC-midnight stamp
  // shows and files a receipt a day early anywhere west of Greenwich.
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
 * The scan's own currency, or null. Only three letters travel: a symbol, "EU"
 * or "USDT" makes `formatMinor` throw, and the form calls it on every render,
 * so adopting one white-screens the page being typed on. Dropped, never
 * repaired — "USDT" clipped to "USD" banks money in a currency nobody named.
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
 * The lines a bill charges for but nobody ordered: a tip, tax on top of the
 * items, and everything taken off. One family because they divide the same way
 * — in proportion to what each person did order — and none can be ticked for
 * on the who-had-what grid.
 *
 * All magnitudes: a discount is what comes *off*, written positive, and the
 * sign is applied in `receiptBreakdown` and nowhere else
 * (docs/data-model.md#money).
 */
export interface BillExtras {
  tip: string | null;
  tax: string | null;
  /**
   * Every deduction, kept apart rather than summed. The arithmetic wouldn't
   * know the difference, but a person reading "Discounts −9.25" cannot tell a
   * two-for-one from a loyalty card, and the grid names them one by one.
   */
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
 * What one line costs in minor units, whichever way the bill stated it — the
 * only multiplication in the reading, and why the model is never asked to do
 * it. `amount` wins when both are filled. Null means no usable figure (a count
 * with no price, a price with no count, an unparseable figure), which
 * `checkScan` reports as `unreadable-line`.
 */
export function lineMinor(item: ScanLineItem, currency: CurrencyCode): number | null {
  const whole = readAmount(item.amount, currency);
  if (whole !== null) return whole;

  const unit = readAmount(item.unitAmount, currency);
  const count = item.quantity;
  // A per-unit price without a count prices nothing, and taking it for the
  // line total would charge three skewers as one.
  if (unit === null || count === null || !Number.isInteger(count) || count <= 0) return null;
  const minor = unit * count;
  // Both integers, so the product is exact right up to where it stops being
  // safe. `parseMinor` guards its own end; the multiplication needs this.
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * A reading with every deduction gathered into one place.
 *
 * A receipt writes a discount wherever it likes — among the items, under the
 * two pizzas it applies to, or above the total — and which of those the model
 * files under `discount` is not worth depending on. Every negative amount,
 * whichever field it arrived on, joins the discount pool, so everything
 * downstream sees one shape: all-positive items and a figure off the lot.
 *
 * Pooling is what makes a discount **proportional**, which is the only reading
 * the grid can justify with no way to say whose a credit is (ADR-0016).
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

  const tip = keep(result.tip, "");
  const tax = keep(result.tax, "");
  const items: BillItem[] = [];
  for (const item of result.lineItems) {
    const minor = lineMinor(item, currency);
    if (minor !== null && minor < 0) {
      discounts.push({ label: item.labelEn ?? item.label, amount: minorToDecimalString(-minor, currency) });
      continue;
    }
    items.push({
      label: item.label,
      labelEn: item.labelEn,
      // A line the bill priced outright keeps the model's own string, down to
      // an unreadable one: `checkScan` refuses it and needs to see what
      // arrived. Only a multiplied line is written out; no usable figure at
      // all becomes "", which reads back as unreadable.
      amount: item.amount ?? (minor === null ? "" : minorToDecimalString(minor, currency)),
      quantity: item.quantity,
    });
  }
  for (const printed of result.discounts) {
    const minor = readAmount(printed.amount, currency);
    // `Math.abs`: a model asked for a magnitude still sometimes echoes the
    // printed minus, and that turns a deduction into a silent surcharge.
    if (minor === null || minor === 0) continue;
    discounts.push({
      label: printed.labelEn ?? printed.label,
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

/**
 * What this bill comes to: the total it states, or its own lines and extras
 * added up. Null when neither is available. The distinction matters to
 * `checkScan`, not to the draft.
 */
export function billTotalMinor(result: ScanResult, currency: CurrencyCode): number | null {
  const stated = readAmount(result.total, currency);
  if (stated !== null) return stated;
  return result.lineItems.length === 0 ? null : sumBill(result, currency);
}

/**
 * Does this reading hold together? `null` when it does.
 *
 * The bar is arithmetic, not judgement: every line and extra readable, and
 * lines plus tip plus tax less discounts equal to the total. Refusing costs one
 * more photo; accepting prices the whole grid against a total the bill never
 * gave, on a bill nobody re-reads.
 *
 * **It reconciles only against a figure the bill itself stated.** A till roll
 * always prints one, so a photograph with no total is a cropped photograph. A
 * typed bill usually has none, and there the lines *are* the bill: they are
 * summed and not then checked against themselves, because a total derived from
 * the lines can only ever agree with them
 * (docs/receipt-scanning.md#what-a-reading-is-checked-against).
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
  // Absent means cropped, on a photograph. Ordinary on a typed bill, but only
  // where there are lines to stand in for it.
  if (!stated && (medium === "photo" || result.lineItems.length === 0)) return "no-total";

  // Before `readBill` gathers them: it takes an illegible figure for nothing
  // at all, and a discount silently worth zero is the error to catch.
  for (const text of [result.tip, result.tax, ...result.discounts.map((d) => d.amount)]) {
    if (text && readAmount(text, currency) === null) return "unreadable-line";
  }

  const sum = sumBill(result, currency);
  if (sum === null) return "unreadable-line";

  // No total of its own: the lines are the bill, and all that is left to ask is
  // whether they come to something somebody could have paid.
  if (total === null) return sum > 0 ? null : "mismatch";

  // Legible and still not a bill: the number read fine, what it says is the
  // problem. A discount bigger than everything it comes off lands here too.
  if (total <= 0) return "mismatch";
  // Nothing to reconcile: a receipt that is just a total is an ordinary
  // expense, and the grid never opens on it.
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
 * What a scan is allowed to cost, and who is allowed to spend it. Shared
 * because both ends need the same numbers: the phone refuses instantly and for
 * free, the Worker refuses again because the phone's copy is only advice. Two
 * copies would drift into quoting one number and enforcing another.
 * docs/receipt-scanning.md#what-the-scan-costs.
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
 * The longest a typed-in bill may be. Beside the budget because it is the same
 * kind of number. Four thousand characters is roughly what the downscaled
 * photo costs in tokens, so typing is never the dearer way — and a sixty-line
 * till roll is about 1,800. The Worker's `MAX_TEXT_BYTES` sits well above it:
 * that is an abuse ceiling on bytes, this is what a person is held to.
 */
export const BILL_TEXT_MAX = 4000;

