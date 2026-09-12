import {
  formatMinor, formatRate,
  type CurrencyCode, type PayerValidation, type Rate, type SplitValidation,
} from "@bida/core";
import { copy, type Noun, type Voice } from "./copy";

/**
 * Display helpers. Money formatting itself lives in core — this file only
 * decides *which* of core's formats a given bit of chrome wants; the words
 * around the figures come from `lib/copy.ts`.
 */

/**
 * The mark between thousands, everywhere this app writes a figure itself
 * rather than handing it to `Intl`: a narrow no-break space. A comma and a
 * point are each somebody's decimal separator and this app accepts both as
 * one; a space is nobody's, so a grouped figure is never ambiguous — and
 * stripping it back out on parse cannot eat a character the typist meant.
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
 * the same way the field you typed it into groups them. A group whose base is
 * a weak currency has rates in the thousands ("1 EUR = 13 000 UZS"), and that
 * was the last figure in the app reading as one long digit string.
 */
export function rateText(rate: Rate, digits?: number): string {
  return groupDigits(digits === undefined ? formatRate(rate) : formatRate(rate, digits));
}

export function money(minor: number, currency: CurrencyCode, signed = false): string {
  return formatMinor(minor, currency, { signDisplay: signed ? "always" : "auto" });
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
 * money. Core hands back a number of minor units and a problem code rather
 * than a sentence, because it doesn't know the currency — "230 minor units
 * unallocated" is not a thing to show anyone. The screen supplies its own
 * wording around the figure.
 */
export function shortfallText(
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
 * - **Nothing to divide.** `validateSplit` scores 0 minor units allocated out
 *   of 0 as a satisfied split. That is arithmetically true and reads as
 *   nonsense — "€0.00 of €0.00 allocated" under an expense whose amount is
 *   still blank, claiming the split is settled when the expense has no number
 *   yet. It is the most-reported bug in this editor, so the string is made
 *   unreachable here rather than guarded at each of the call sites that can
 *   reach a zero total.
 */
export function splitFooter(
  check: SplitValidation,
  currency: CurrencyCode,
): { ok: boolean; text: string } | null {
  if (check.problem === "empty") return { ok: false, text: copy.split.nobody };
  // No total is not a sentence here any more. A zero total is arithmetically a
  // satisfied split and must never be shown as one — but the amount field is
  // what's missing and the amount field is what says so, by flashing red on a
  // refused Save. Two places saying it made the second one noise.
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
 * when it can. The payers screen shows it under its own table and the entry
 * form shows it beside the payer field: same sentence either way, because a
 * person moving between the two screens is looking at one thing.
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
 * What a person *sees* as one character. `slice(0, 1)` counts UTF-16 code
 * units, so a name starting with an emoji lost half a surrogate pair and drew
 * the replacement box; a flag or a family is longer still. `Intl.Segmenter`
 * counts what the font draws, and code points are the fallback where it is
 * missing — wrong only for sequences no avatar has room for anyway.
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
 * How wide a who-had-what column heading is allowed to get. Three graphemes:
 * the grid is one tappable cell per person per line, so the headings set the
 * column width, and a name that keeps growing until it is unique took the
 * whole screen — "Bartholomew" beside "Bartholomew Junior" used to print both
 * names in full and leave no room for the bill.
 */
const CODE_MAX = 3;

/**
 * The shortest prefix of each name that tells everyone apart — "John" and
 * "Jane" become "Jo"/"Ja" rather than colliding on "J". Grows a grapheme at a
 * time, but never past three: whoever still collides there is numbered
 * instead, so "Bartholomew" and "Bartholomew Junior" are "Ba1" and "Ba2"
 * rather than two headings as wide as the grid.
 *
 * The numbering is why no name may already contain a digit. "ba1" as a name
 * would be indistinguishable from "Ba" numbered 1, so a group holding one
 * gives up on unique codes altogether and takes the bare three-grapheme
 * prefixes, repeats and all — three characters cannot be injective over
 * arbitrary names, and a group that names somebody "ba1" has chosen which
 * half of that to lose. The chips under "Who was there" carry the full names,
 * which is where a repeated code is read.
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

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today" / "Yesterday" / "Sat 5 April" — the ledger's day rule. */
export function dayLabel(ts: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY);
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
 * exactly one, which is the ordinary case and says nothing worth printing.
 *
 * A count is a fraction because sharing makes it one: a plate split three ways
 * is a third of it each, and the same plate ordered twice and shared once is
 * one and a half. Written out with a slash rather than as ½ ⅓ ¼: the single
 * glyphs are drawn at a fraction of the line's size, which is unreadable at
 * the size this text is already set in.
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
