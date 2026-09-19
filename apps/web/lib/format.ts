import {
  formatMinor, formatRate, startOfLocalDay,
  type CurrencyCode, type PayerValidation, type Rate, type SplitValidation,
} from "@bida/core";
import { copy, type Noun, type Voice } from "./copy";

/**
 * Display helpers. Money formatting itself lives in core — this file only
 * decides *which* of core's formats a given bit of chrome wants; the words
 * around the figures come from `lib/copy.ts`.
 */

/**
 * The mark between thousands wherever this app writes a figure itself rather
 * than handing it to `Intl`: a narrow no-break space. A comma and a point are
 * each somebody's decimal separator and this app accepts both; a space is
 * nobody's, so stripping it on parse cannot eat a character the typist meant.
 */
export const GROUP = "\u202f";

/**
 * "4800.5" -> "4\u202f800.5". Display only; never stored, never parsed.
 *
 * For the figures this app formats itself and `Intl` does not: what you are
 * typing into an amount field, and a rate. Amounts already read are `money()`
 * and `bare()` below, which are `Intl`-grouped.
 */
export function groupDigits(canonical: string): string {
  const [whole = "", frac] = canonical.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

/**
 * A rate, as every screen shows one — exact decimal text, thousands grouped
 * the way the field you typed it into groups them. A group based on a weak
 * currency has rates in the thousands ("1 EUR = 13 000 UZS"), which is
 * unreadable as one long digit string.
 */
export function rateText(rate: Rate, digits?: number): string {
  return groupDigits(digits === undefined ? formatRate(rate) : formatRate(rate, digits));
}

export function money(minor: number, currency: CurrencyCode, signed = false): string {
  return formatMinor(minor, currency, { signDisplay: signed ? "always" : "auto" });
}

/**
 * The tip screen's dollars, and nothing else's. `money()` hands `Intl` the
 * reader's locale, which is right for the group's money and wrong here:
 * outside the US it renders USD as "US$1.25", one line under a `$5` the copy
 * writes by hand. Pinned to en-US so the cut matches the price it is cut of.
 */
export function usd(minor: number): string {
  return formatMinor(minor, "USD", { locale: "en-US" });
}

/**
 * Bare figure, no symbol — for columns with their own header.
 *
 * **Display only.** It is `Intl`-grouped, so it is not what `parseMinor` reads
 * back: "1,234.50" throws, and JPY "25,000" parses as 25. Anything canonical —
 * an `AmountInput`'s `value`, a draft's `amountText` — wants core's
 * `minorToDecimalString` instead.
 */
export function bare(minor: number, currency: CurrencyCode): string {
  return formatMinor(minor, currency, { showCurrency: false });
}

/**
 * The "this doesn't add up" sentence for the split and payer editors, in real
 * money. Core hands back minor units and a problem code rather than a
 * sentence, because it doesn't know the currency; the screen supplies the
 * wording around the figure.
 */
function shortfallText(
  check: { problem?: string; diffMinor?: number; message?: string },
  currency: CurrencyCode,
  words: { under: string; over: string },
): string {
  const diff = check.diffMinor ?? 0;
  if (check.problem === "under") return `${money(diff, currency)} ${words.under}`;
  if (check.problem === "over") return `${money(-diff, currency)} ${words.over}`;
  return check.message ?? "";
}

/**
 * The split editor's bottom line. `shortfallText` handles the ordinary "some
 * of it is missing" case; this wraps it with the two verdicts that need the
 * total itself rather than the shortfall:
 *
 * - **Nobody included yet.** A figure would be beside the point; say the thing.
 * - **Nothing to divide.** `validateSplit` scores 0 of 0 allocated as a
 *   satisfied split — arithmetically true, and nonsense under an expense whose
 *   amount is still blank. Made unreachable here rather than guarded at each
 *   call site that can reach a zero total.
 */
export function splitFooter(
  check: SplitValidation,
  currency: CurrencyCode,
): { ok: boolean; text: string } | null {
  if (check.problem === "empty") return { ok: false, text: copy.split.nobody };
  // A zero total is arithmetically a satisfied split and must never be shown
  // as one — but the amount field is what's missing, and it says so itself by
  // flashing red on a refused Save. A second voice here is noise.
  if (check.totalMinor <= 0) return null;
  if (check.ok) {
    return {
      ok: true,
      text: copy.split.allocated(money(check.allocatedMinor, currency), money(check.totalMinor, currency)),
    };
  }
  return {
    ok: false,
    text: shortfallText(check, currency, { under: copy.split.under, over: copy.split.over }),
  };
}

/**
 * Why the payer side can't be saved, in the entry's own currency — or `null`
 * when it can. The payers screen shows it under its table and the entry form
 * beside the payer field: the same sentence either way, because a person
 * moving between the two screens is looking at one thing.
 */
export function payerProblemText(
  check: PayerValidation, currency: CurrencyCode, voice: Voice = "expense",
): string | null {
  if (check.ok) return null;
  // "Nobody" needs the words, not the figure: the shortfall is the whole
  // amount, and "€40.00 still unaccounted for" doesn't say the table is empty.
  if (check.problem === "empty") return copy.payers.nobody[voice];
  return shortfallText(check, currency, { under: copy.payers.under, over: copy.payers.over });
}

/**
 * What a rejected promise says to a person. Anything thrown that isn't an
 * `Error` is stringified rather than dropped — a bare string thrown by a
 * dependency still beats a screen that silently does nothing.
 */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * What a person *sees* as one character. **Never `slice(0, 1)`**: it counts
 * UTF-16 code units, so a name starting with an emoji keeps half a surrogate
 * pair and draws the replacement box, and a flag or a family is longer still.
 * `Intl.Segmenter` counts what the font draws; code points are the fallback
 * where it is missing, wrong only for sequences no avatar has room for.
 */
const graphemer = typeof Intl !== "undefined" && "Segmenter" in Intl
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

export function graphemes(s: string): string[] {
  return graphemer ? Array.from(graphemer.segment(s), (g) => g.segment) : Array.from(s);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return copy.unknown;
  const first = graphemes(parts[0]!)[0] ?? "";
  if (parts.length === 1) return first.toUpperCase();
  return (first + (graphemes(parts[parts.length - 1]!)[0] ?? "")).toUpperCase();
}

/**
 * How wide a who-had-what column heading may get. Three graphemes: the grid is
 * one tappable cell per person per line, so the headings set the column width,
 * and a prefix grown until it is unique leaves no room for the bill.
 */
const CODE_MAX = 3;

/**
 * The shortest prefix of each name that tells everyone apart — "John" and
 * "Jane" become "Jo"/"Ja" rather than colliding on "J". Grows a grapheme at a
 * time, but never past three: whoever still collides there is numbered
 * instead, so "Bartholomew" and "Bartholomew Junior" are "Ba1" and "Ba2"
 * rather than two headings as wide as the grid.
 *
 * The numbering is why no name may already contain a digit: "ba1" as a name is
 * indistinguishable from "Ba" numbered 1, so a group holding one gives up on
 * unique codes and takes the bare three-grapheme prefixes, repeats and all.
 * Three characters cannot be injective over arbitrary names. The chips under
 * "Who was there" carry the full names, which is where a repeat is read.
 */
export function distinctInitials(members: readonly { id: string; name: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  const chars = new Map(members.map((m) => [m.id, graphemes(m.name.trim())]));
  const prefix = (id: string, len: number) => chars.get(id)!.slice(0, len).join("") || copy.unknown;
  for (let len = 1; len <= CODE_MAX; len++) {
    const byPrefix = new Map<string, string[]>();
    for (const m of members) {
      if (out.has(m.id)) continue;
      const p = prefix(m.id, len);
      byPrefix.set(p, [...(byPrefix.get(p) ?? []), m.id]);
    }
    for (const [p, ids] of byPrefix) {
      if (ids.length === 1) out.set(ids[0]!, p);
    }
  }
  const left = members.filter((m) => !out.has(m.id));
  // ASCII digits only: the suffix is written with those, so those are the ones
  // a name can be confused with.
  const numbered = !members.some((m) => /[0-9]/.test(m.name));
  left.forEach((m, i) => {
    if (!numbered) { out.set(m.id, prefix(m.id, CODE_MAX)); return; }
    // Numbered across all the leftovers rather than within each colliding
    // group, so the digits alone tell them apart: a code ends in exactly as
    // many digits as its number has (no name holds one), so no two can land on
    // the same string however their prefixes were cut.
    const n = String(i + 1);
    const room = CODE_MAX - n.length;
    out.set(m.id, (room > 0 ? prefix(m.id, room) : "") + n);
  });
  return out;
}

const DAY = 86_400_000;

/** "Today" / "Yesterday" / "Sat 5 April" — the ledger's day rule. */
export function dayLabel(ts: number, now = Date.now()): string {
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(ts)) / DAY);
  if (days === 0) return copy.time.today;
  if (days === 1) return copy.time.yesterday;
  const d = new Date(ts);
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === new Date(now).getFullYear()
      ? { weekday: "short", day: "numeric", month: "long" }
      : { day: "numeric", month: "long", year: "numeric" };
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

/** "2h ago", "yesterday", "Feb" — deliberately vague past a week. */
export function ago(ts: number, now = Date.now()): string {
  const ms = now - ts;
  if (ms < 60_000) return copy.time.justNow;
  if (ms < 3_600_000) return copy.time.minutesAgo(Math.floor(ms / 60_000));
  if (ms < DAY) return copy.time.hoursAgo(Math.floor(ms / 3_600_000));
  if (ms < 2 * DAY) return copy.time.agoYesterday;
  if (ms < 7 * DAY) return copy.time.daysAgo(Math.floor(ms / DAY));
  const d = new Date(ts);
  return new Intl.DateTimeFormat(undefined, { month: "short", ...(d.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }) }).format(d);
}

export function clockTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}

/**
 * "Today · 18:22" — or the day alone for an entry whose stamp is a day and
 * nothing more (`dateOnly`), where a clock would be printing 00:00 as though
 * somebody had read it off a receipt.
 */
export function whenLabel(entry: Whenever, now = Date.now()): string {
  return entry.dateOnly
    ? dayLabel(entry.occurredAt, now)
    : `${dayLabel(entry.occurredAt, now)} · ${clockTime(entry.occurredAt)}`;
}

/** Anything the ledger places in time: an expense, a transfer, a row built from one. */
interface Whenever {
  occurredAt: number;
  dateOnly?: boolean | null;
  createdAt?: number | null;
}

/**
 * The ledger's order: newest day first; inside a day, the entries whose stamp
 * is a day and nothing more, then the rest by time, latest first.
 *
 * A `dateOnly` entry heads its day rather than sinking to the bottom where its
 * midnight stamp would put it: the time is missing, not early. `createdAt`
 * then breaks ties, so two entries backdated to the same day have a stable
 * order rather than whatever IndexedDB handed back; where it is absent,
 * `occurredAt` stands in — a wash, but never crashes.
 */
export function byWhen(a: Whenever, b: Whenever): number {
  const day = startOfLocalDay(b.occurredAt) - startOfLocalDay(a.occurredAt);
  if (day !== 0) return day;
  if (!a.dateOnly !== !b.dateOnly) return a.dateOnly ? -1 : 1;
  const time = a.dateOnly ? 0 : b.occurredAt - a.occurredAt;
  return time || ((b.createdAt ?? b.occurredAt) - (a.createdAt ?? a.occurredAt));
}

/** "FRI 4 APRIL · 18:22" — the history timeline's stamp. */
export function stamp(ts: number): string {
  const d = new Date(ts);
  const date = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(d);
  return `${date.toUpperCase()} · ${clockTime(ts)}`;
}

/**
 * "3 changes". The noun is a `{ one, many }` pair from `lib/copy.ts` rather
 * than a word plus an "s" — the plural of a word is the translation's business,
 * not this function's.
 */
export function plural(n: number, noun: Noun): string {
  return `${n} ${n === 1 ? noun.one : noun.many}`;
}

/** Date input value ("2026-04-04") from a timestamp, in local time. */
export function dateInputValue(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The inverse of `dateInputValue`: local midnight of a `YYYY-MM-DD` day. What
 * an imported row's `occurredAt` becomes, and what a backdated scan already
 * uses (docs/data-model.md).
 *
 * **Never `Date.parse`**: it reads a bare date as UTC, which lands the day
 * before for anyone west of Greenwich.
 */
export function dayStart(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return Number.NaN;
  return new Date(y, m - 1, d).getTime();
}

/** Keep the time of day when the user only changes the date. */
export function withDate(ts: number, value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return ts;
  const out = new Date(ts);
  out.setFullYear(y, m - 1, d);
  return out.getTime();
}

/**
 * How many of something somebody had: "2", "1/2", "1 1/2" — or null for
 * exactly one, the ordinary case, which says nothing worth printing.
 *
 * A count is a fraction because sharing makes it one: a plate split three ways
 * is a third each. Written with a slash rather than as ½ ⅓ ¼, whose glyphs are
 * drawn at a fraction of the line's size and unreadable at this text size.
 */
export function countText(count: { n: number; d: number }): string | null {
  if (count.d <= 0 || count.n <= 0) return null;
  // Reduced here rather than trusted: 2/6 of a plate is a third of it.
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(count.n, count.d) || 1;
  const [n, d] = [count.n / g, count.d / g];
  const whole = Math.floor(n / d);
  const rest = n - whole * d;
  if (rest === 0) return whole === 1 ? null : String(whole);
  return whole === 0 ? `${rest}/${d}` : `${whole} ${rest}/${d}`;
}
