/**
 * Turns a model's reading of a receipt into an entry-draft patch. The model
 * does the reading — title, total, currency, date — and this
 * does no arithmetic or reformatting on top of it. See docs/receipt-scanning.md.
 *
 * Amounts and dates are trusted in the exact shape asked for in the prompt
 * (plain decimal notation; `YYYY-MM-DD`), so there's no separator-guessing or
 * multi-format parser to maintain here.
 */

import { isCurrencyCode, minorToDecimalString, parseMinor, type CurrencyCode } from "./money.js";
import type { ScanMedium } from "./scan-body.js";
import type { ReceiptDiscount } from "./types.js";
import { sameLocalDay } from "./when.js";

/**
 * One line of a bill: what it's called, translated, how many, and what it cost.
 *
 * **The cost arrives one of two ways, and only one of them is filled.** A till
 * prints the extension, so a photographed line gives `amount`. Somebody typing
 * writes the price of one — "3 chicken at 13 each" — so a typed line gives
 * `unitAmount` and a `quantity`, and the 39 exists nowhere on the page. Asking
 * the model for a figure the bill does not hold is what makes it invent one, so
 * it returns whichever the bill gave and `lineMinor` does the multiplying here,
 * in integer minor units, where it is tested.
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
 * One line the app can price: the figure resolved, whichever way the bill wrote
 * it. This is what `readBill` hands on, so nothing downstream of it has to know
 * that a per-unit price was ever a possibility.
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
 * `now` is the moment of the scan. A receipt printed today was paid at some
 * point before it, so it takes `now` as its stamp — close enough, and a real
 * time of day. A receipt from any other day takes local midnight of the day
 * it prints, and says `dateOnly`: the hour is not on the receipt, and the
 * ledger neither prints one nor pretends the purchase happened at 00:00.
 *
 * `currency` is what the reading will be counted in — `scanCurrency(result,
 * draft.currency)` — and it is here for one case: a bill that states no total
 * of its own, where the amount field is filled from the lines and that sum has
 * to be written in the currency the draft is about to hold.
 */
export function normalizeScan(result: ScanResult, currency: CurrencyCode, now: number): ScanPatch {
  const patch: ScanPatch = {};
  if (result.title) patch.description = result.title;
  if (result.total) {
    // A stated total passes through as the model wrote it, untouched: it is
    // already in the notation the prompt asked for, and re-rendering it would
    // be this function having an opinion about a figure it did not compute.
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

/**
 * The three lines a bill charges for but nobody ordered: a tip, tax printed on
 * top of the items, and everything taken off. They are one family because they
 * divide the same way — in proportion to what each person did order — and
 * because none of them can be ticked for on the who-had-what grid.
 *
 * All three are magnitudes: `discount` is what comes *off*, written positive,
 * and the sign is applied where it is spent (`receiptBreakdown`) and nowhere
 * else — the same rule money follows everywhere in this codebase
 * (docs/data-model.md#money).
 */
export interface BillExtras {
  tip: string | null;
  tax: string | null;
  /**
   * Every deduction, kept apart rather than summed. They divide identically,
   * so the arithmetic would not know the difference — but a person reading
   * "Discounts −9.25" cannot tell a two-for-one from a loyalty card, and both
   * the grid and each person's own copy of the bill name them one by one.
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
 * What one line costs, in minor units, whichever way the bill stated it — the
 * only multiplication anywhere in the reading, and the reason the model is
 * never asked to do it.
 *
 * `amount` wins where both are somehow filled: a line total the bill states
 * outranks a per-unit price we would have to multiply. Null is "this line has
 * no usable figure", which `checkScan` reports as `unreadable-line` — a count
 * with no price, a price with no count, or a figure that won't parse.
 */
export function lineMinor(item: ScanLineItem, currency: CurrencyCode): number | null {
  const whole = readAmount(item.amount, currency);
  if (whole !== null) return whole;

  const unit = readAmount(item.unitAmount, currency);
  const count = item.quantity;
  // A per-unit price is half a figure: without the count it prices nothing, and
  // taking it for the line total would charge three skewers as one.
  if (unit === null || count === null || !Number.isInteger(count) || count <= 0) return null;
  const minor = unit * count;
  // Minor units are integers and the count is an integer, so the product is
  // exact — right up to the point where it isn't a safe one. `parseMinor`
  // guards its own end of this; the multiplication needs the same guard.
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * A reading, with every deduction gathered into one place.
 *
 * A receipt writes a discount wherever it likes — a "-5.00 LOYALTY" line among
 * the items, a "2 FOR 1  -8.00" under the two pizzas, a bill-level figure
 * above the total — and which of those a model files under `discount` and
 * which it returns as a negative line is not worth depending on. So every
 * negative amount, whichever field it arrived on, is moved into the discount
 * pool, and everything downstream sees one shape: items that are all positive,
 * and a single figure that comes off the lot.
 *
 * That pooling is what makes a discount **proportional**: it is taken off each
 * person in the ratio of what they ordered, which is also the only reading the
 * grid can justify while it has no way to say who a particular credit belongs
 * to (ADR-0016, docs/product.md).
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
      // an unreadable one — `checkScan` is what refuses that, and it needs to
      // see what arrived. Only a line we multiplied is written out here, and a
      // line with no usable figure at all becomes the empty string, which reads
      // back as unreadable exactly as it should.
      amount: item.amount ?? (minor === null ? "" : minorToDecimalString(minor, currency)),
      quantity: item.quantity,
    });
  }
  for (const printed of result.discounts) {
    const minor = readAmount(printed.amount, currency);
    // `Math.abs`, because a model asked for a magnitude still sometimes echoes
    // the minus sign the receipt printed — and a sign read the wrong way round
    // turns a deduction into a surcharge, silently, on somebody's money.
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
 * What this bill comes to: the total it states, or — for one that states none —
 * its own lines and extras added up. Null when neither is available.
 *
 * The distinction matters to `checkScan` and not to the draft: what goes in the
 * amount field is a number either way.
 */
export function billTotalMinor(result: ScanResult, currency: CurrencyCode): number | null {
  const stated = readAmount(result.total, currency);
  if (stated !== null) return stated;
  return result.lineItems.length === 0 ? null : sumBill(result, currency);
}

/**
 * Does this reading hold together? `null` when it does.
 *
 * The bar is arithmetic, not judgement: every line and every extra readable,
 * and the lines plus tip plus tax less the discounts equal to the total. A scan
 * the app can't reconcile is a scan that failed — importing one prices
 * everybody in the who-had-what grid against a total the bill never gave,
 * silently, on a bill nobody re-reads. Refusing costs one more photo; accepting
 * costs somebody money.
 *
 * **What it reconciles against has to be a figure the bill itself stated.** A
 * till roll always prints one, so a photograph with no total is a cropped
 * photograph and is refused as it always was. A typed bill usually has none —
 * the person who had already added it up did not need us — and there the lines
 * *are* the bill: they are summed, and the sum is not then checked against
 * itself, because a total we worked out from the lines can only ever agree with
 * them. That is not a weaker check, it is an honest one; the alternative on
 * offer is a model-supplied total, which agrees with the lines by being quietly
 * adjusted until it does (docs/receipt-scanning.md#what-a-reading-is-checked-against).
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
  // And one that is absent: cropped, on a photograph. On a typed bill it is
  // ordinary — but only where there are lines to stand in for it.
  if (!stated && (medium === "photo" || result.lineItems.length === 0)) return "no-total";

  // Read before `readBill` gathers them: it takes an illegible figure for
  // nothing at all, and a discount silently worth zero is the one error this
  // function exists to catch.
  for (const text of [result.tip, result.tax, ...result.discounts.map((d) => d.amount)]) {
    if (text && readAmount(text, currency) === null) return "unreadable-line";
  }

  const sum = sumBill(result, currency);
  if (sum === null) return "unreadable-line";

  // No total of its own: the lines are the bill, and all that is left to ask is
  // whether they come to something somebody could have paid.
  if (total === null) return sum > 0 ? null : "mismatch";

  // Legible and still not a bill. It lands here rather than in "no-total"
  // because the number was read fine; what it says is the problem. A discount
  // bigger than everything it comes off arrives here too, which is the right
  // door: what is wrong is the arithmetic, not any one line.
  if (total <= 0) return "mismatch";
  // Nothing to reconcile when no lines were given — a receipt that is just a
  // total is an ordinary expense, and the grid never opens on it.
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
 * What a scan is allowed to cost, and who is allowed to spend it.
 *
 * Here rather than in the Worker because both ends need the same numbers: the
 * phone refuses a scan it already knows is over the caller's budget, so the
 * refusal is instant and costs no request, and the Worker refuses it again
 * because the phone's copy is advice. Two copies of "10 an hour" would drift
 * into the app quoting one number and enforcing another.
 *
 * The reasoning behind each is docs/receipt-scanning.md#what-the-scan-costs;
 * only `caller` is checkable from a phone, which is the whole of what a phone
 * knows about.
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
 * The longest a bill somebody types in may be, in characters.
 *
 * Here beside the budget because it is the same kind of number: what one
 * reading is allowed to cost. Four thousand characters is roughly what the
 * downscaled photo costs in tokens, so a typed bill is never the dearer way to
 * read one — and no real bill comes close, a sixty-line till roll being about
 * 1,800. The Worker's `MAX_TEXT_BYTES` sits well above this: that one is an
 * abuse ceiling on bytes, and this is the number a person is held to.
 */
export const BILL_TEXT_MAX = 4000;

