/**
 * Money is always an integer number of minor units (cents, agorot, fils...).
 * There is no float representation of money anywhere in this codebase.
 * See docs/data-model.md#money.
 */

export type CurrencyCode = string;

/** ISO 4217 currencies whose minor-unit exponent is not 2. */
const EXPONENT_OVERRIDES: Record<string, number> = {
  // zero-decimal
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  // three-decimal
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  // four-decimal
  CLF: 4, UYW: 4,
};

/**
 * True for the three ASCII letters `Intl.NumberFormat` accepts as a currency —
 * the one thing `formatMinor` needs and cannot be talked out of. Anything else
 * ("€", "EU", "USDT") makes it throw, so every code that reaches the model,
 * the picker or a draft is checked against this first.
 */
export function isCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

/** Minor-unit exponent for a currency. Defaults to 2. Never assume 2 yourself. */
export function exponentOf(currency: CurrencyCode): number {
  return EXPONENT_OVERRIDES[currency.toUpperCase()] ?? 2;
}

/** 10^n as a bigint. */
function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** Round a bigint quotient half-away-from-zero. `den` must be positive. */
function divRound(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError("divRound: denominator must be positive");
  const neg = num < 0n;
  const abs = neg ? -num : num;
  const q = abs / den;
  const r = abs * 2n;
  const rounded = r - q * den * 2n >= den ? q + 1n : q;
  return neg ? -rounded : rounded;
}

/**
 * Parse a human-typed decimal string into minor units.
 * Accepts "12.34", "12,34", " 1 234,56 ", "-5". Rejects anything else.
 */
export function parseMinor(input: string, currency: CurrencyCode): number {
  const cleaned = input.trim().replace(/\s| |_/g, "").replace(",", ".");
  if (!/^-?\d*(\.\d*)?$/.test(cleaned) || cleaned === "" || cleaned === "-") {
    throw new RangeError(`parseMinor: cannot parse ${JSON.stringify(input)}`);
  }
  const neg = cleaned.startsWith("-");
  const body = neg ? cleaned.slice(1) : cleaned;
  const [whole = "0", frac = ""] = body.split(".");
  const exp = exponentOf(currency);
  const fracPadded = (frac + "0".repeat(exp)).slice(0, exp);
  const dropped = frac.slice(exp);
  let minor = BigInt(whole || "0") * pow10(exp) + BigInt(fracPadded || "0");
  // round away the excess precision the user typed rather than truncating
  if (dropped.length > 0 && Number(dropped[0]) >= 5) minor += 1n;
  const out = Number(neg ? -minor : minor);
  if (!Number.isSafeInteger(out)) throw new RangeError("parseMinor: amount out of range");
  return out;
}

/** Minor units as a plain decimal string: 5710 EUR -> "57.10". No symbol, no grouping. */
export function minorToDecimalString(minor: number, currency: CurrencyCode): string {
  const exp = exponentOf(currency);
  const neg = minor < 0;
  const abs = BigInt(Math.abs(Math.trunc(minor)));
  const d = pow10(exp);
  const whole = abs / d;
  const frac = abs % d;
  const fracStr = exp === 0 ? "" : "." + frac.toString().padStart(exp, "0");
  return `${neg ? "-" : ""}${whole}${fracStr}`;
}

export interface FormatOptions {
  /** BCP-47 locale. Defaults to the runtime's. */
  locale?: string;
  /** Show the currency symbol/code. Default true. */
  showCurrency?: boolean;
  /** Force a leading + on positive, non-zero amounts. */
  signDisplay?: "auto" | "always" | "never";
}

/**
 * Format minor units for display. This is the ONLY place money becomes a string
 * for a human. Never reach for toFixed.
 */
export function formatMinor(
  minor: number,
  currency: CurrencyCode,
  options: FormatOptions = {},
): string {
  const { locale, showCurrency = true, signDisplay = "auto" } = options;
  const exp = exponentOf(currency);
  // Intl takes a Number; we hand it an exactly-representable decimal built from
  // the integer, so no precision is invented along the way.
  const value = Number(minorToDecimalString(minor, currency));
  const fmt = new Intl.NumberFormat(locale, {
    style: showCurrency ? "currency" : "decimal",
    currency: showCurrency ? currency : undefined,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
    signDisplay: signDisplay === "always" ? "exceptZero" : signDisplay,
  });
  return fmt.format(value);
}

/**
 * A foreign-exchange rate, held as an exact decimal string ("0.0921").
 * Never a float: 0.1 + 0.2 problems become other people's money.
 */
export type Rate = string;

export function isValidRate(rate: string): boolean {
  return /^\d+(\.\d+)?$/.test(rate.trim()) && Number(rate) > 0;
}

/**
 * Whatever a keyboard produced, as the text `isValidRate` reads. "," is the
 * decimal separator to half of Europe, and the rate was the one money field
 * that refused it — every other one goes through the amount input, which has
 * normalised it from the start. Nothing is clipped: how many decimals a rate
 * carries is its own business (ADR-0005).
 */
export function sanitizeRate(raw: string): string {
  const text = raw.replace(/[^0-9.,]/g, "").replace(/,/g, ".");
  const first = text.indexOf(".");
  if (first === -1) return text;
  return text.slice(0, first + 1) + text.slice(first + 1).replace(/\./g, "");
}

function parseRate(rate: Rate): { num: bigint; scale: number } {
  const s = rate.trim();
  if (!isValidRate(s)) throw new RangeError(`invalid rate: ${JSON.stringify(rate)}`);
  const [whole = "0", frac = ""] = s.split(".");
  return { num: BigInt(whole + frac), scale: frac.length };
}

/**
 * Convert an amount in `from` minor units into `to` minor units at `rate`,
 * where rate is expressed as "1 unit of `from` = rate units of `to`".
 *
 * Rounded once, half-away-from-zero. The result is stored, not recomputed —
 * see ADR-0005.
 */
export function convertMinor(
  minor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rate: Rate,
): number {
  const { num, scale } = parseRate(rate);
  const expFrom = exponentOf(from);
  const expTo = exponentOf(to);
  // minor/10^expFrom * (num/10^scale) * 10^expTo
  const numerator = BigInt(Math.trunc(minor)) * num * pow10(expTo);
  const denominator = pow10(scale + expFrom);
  const out = Number(divRound(numerator, denominator));
  if (!Number.isSafeInteger(out)) throw new RangeError("convertMinor: result out of range");
  return out;
}

/** Sum minor amounts safely. */
export function sumMinor(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  if (!Number.isSafeInteger(total)) throw new RangeError("sumMinor: overflow");
  return total;
}

/**
 * How many significant digits a rate the app produced carries.
 *
 * Not a precision limit on money — `convertMinor` reads the whole string —
 * but on the two places the app writes a rate instead of a person: what comes
 * back from the feed, and the reciprocal of what somebody typed the other way
 * round. Twelve is chosen so a rate typed as its inverse survives the round
 * trip: "4.5" stores as 1/4.5 to twelve digits, and inverting that back at
 * `RATE_SHOWN_DIGITS` reads "4.5" again rather than "4.500000001".
 */
export const RATE_DIGITS = 12;

/** Significant digits a rate is *shown* with. Six is where a human stops reading. */
export const RATE_SHOWN_DIGITS = 6;

/** "1.0834e-5" -> "0.000010834". `isValidRate` rejects exponent notation. */
function expandExponent(text: string): string {
  const e = text.indexOf("e");
  if (e === -1) return text;
  const exponent = Number(text.slice(e + 1));
  const [whole = "0", frac = ""] = text.slice(0, e).split(".");
  const digits = whole + frac;
  // Where the point sits once the exponent is spent, counted from the left.
  const point = whole.length + exponent;
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + "0".repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** Drop the zeros a fixed-digit rounding left on the end. "4.500" -> "4.5". */
function trimRate(text: string): string {
  if (!text.includes(".")) return text;
  const trimmed = text.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}

/**
 * A rate from a JSON number, as the exact decimal string `Rate` is.
 *
 * The feed publishes rates as JSON numbers, which are floats — this is the
 * one door they come in through, and it closes behind them: everything
 * downstream is the string. `toPrecision` does the rounding (the float is
 * already the only value we have; no arithmetic is done on it here) and the
 * two helpers above undo the two shapes it can produce that `isValidRate`
 * rejects — an exponent, and trailing zeros.
 */
export function rateFromNumber(value: number, significantDigits = RATE_DIGITS): Rate {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`rateFromNumber: ${value} is not a positive finite number`);
  }
  const rate = trimRate(expandExponent(value.toPrecision(significantDigits)));
  if (!isValidRate(rate)) throw new RangeError(`rateFromNumber: produced ${JSON.stringify(rate)}`);
  return rate;
}

/**
 * Round a positive decimal string to `significantDigits`, half-away-from-zero.
 * Works on the digits themselves — no float, no `toPrecision`, since the input
 * may carry more precision than a double holds.
 */
function toSignificant(whole: string, frac: string, significantDigits: number): string {
  const digits = whole + frac;
  const lead = digits.search(/[1-9]/);
  if (lead === -1) return "0";
  const keep = lead + significantDigits;
  if (keep >= digits.length) return trimRate(`${whole}.${frac}`);
  // Round the kept prefix as an integer, then put the point back where the
  // whole part ends. Carrying past the front ("999" -> "1000") lengthens it,
  // which moves the point one to the right — exactly what the extra digit means.
  const roundUp = Number(digits[keep]) >= 5;
  const kept = (BigInt(digits.slice(0, keep)) + (roundUp ? 1n : 0n)).toString()
    .padStart(keep, "0");
  const point = whole.length + (kept.length - keep);
  const padded = kept + "0".repeat(Math.max(0, point - kept.length));
  return trimRate(point <= 0
    ? `0.${"0".repeat(-point)}${padded}`
    : `${padded.slice(0, point) || "0"}.${padded.slice(point)}`);
}

/**
 * The same rate read the other way round: "1 PLN = 0.234 EUR" becomes
 * "1 EUR = 4.27350 PLN".
 *
 * The registry stores one direction and the dialog offers both, so this runs
 * on every keystroke in the field somebody isn't typing in. Exact bigint long
 * division to `significantDigits`, never `1 / Number(rate)`: a reciprocal that
 * a person then saves *becomes* the rate every balance is computed from, so it
 * is money arithmetic and gets money arithmetic's treatment.
 */
export function invertRate(rate: Rate, significantDigits = RATE_DIGITS): Rate {
  const { num, scale } = parseRate(rate);
  // 1 / (num / 10^scale) = 10^scale / num, taken to enough places that
  // `toSignificant` has a digit to round on however small the result is.
  const places = significantDigits + num.toString().length + 1;
  const scaled = divRound(pow10(scale + places), num).toString().padStart(places + 1, "0");
  const cut = scaled.length - places;
  return toSignificant(scaled.slice(0, cut), scaled.slice(cut), significantDigits);
}

/** A rate as a person reads it — the stored precision is for arithmetic, not eyes. */
export function formatRate(rate: Rate, significantDigits = RATE_SHOWN_DIGITS): string {
  const { num, scale } = parseRate(rate);
  const text = num.toString().padStart(scale + 1, "0");
  const cut = text.length - scale;
  return toSignificant(text.slice(0, cut), text.slice(cut), significantDigits);
}
