import {
  formatMinor, formatMinorParts, formatRate, parseMinor, startOfLocalDay,
  type CurrencyCode, type PayerValidation, type Rate, type SplitValidation,
} from "@bida/core";
import { copy, type Noun, type Voice } from "./copy";

/**
 * A narrow no-break space. A comma and a point are each somebody's decimal
 * separator; a space is nobody's, so stripping it on parse eats nothing meant.
 */
export const GROUP = "\u202f";

/** "4800.5" -> "4 800.5", for typed amounts and rates. Display only. */
export function groupDigits(canonical: string): string {
  const [whole = "", frac] = canonical.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

/** "13 000": exact, grouped. */
export function rateText(rate: Rate, digits?: number): string {
  return groupDigits(digits === undefined ? formatRate(rate) : formatRate(rate, digits));
}

export function money(minor: number, currency: CurrencyCode, signed = false): string {
  return formatMinor(minor, currency, { signDisplay: signed ? "always" : "auto" });
}

/**
 * `money()` in pieces, for a figure set at three sizes. `fraction` carries its
 * decimal mark; `currencyFirst` follows the locale ("UZS 150,779.27" but
 * "150 779,27 UZS").
 */
export interface MoneyParts { currency: string; whole: string; fraction: string; currencyFirst: boolean }

export function moneyParts(minor: number, currency: CurrencyCode, locale?: string): MoneyParts {
  const out: MoneyParts = { currency: "", whole: "", fraction: "", currencyFirst: false };
  for (const { type, value } of formatMinorParts(minor, currency, { locale })) {
    if (type === "currency") {
      out.currency = value;
      out.currencyFirst = out.whole === "";
    } else if (type === "decimal" || type === "fraction") out.fraction += value;
    else if (type !== "literal") out.whole += value;
  }
  return out;
}

/** Pinned to en-US: elsewhere `money()` renders "US$1.25" beside the tip screen's hand-written `$5`. */
export function usd(minor: number): string {
  return formatMinor(minor, "USD", { locale: "en-US" });
}

/**
 * No symbol. Display only: `parseMinor` can't read it back (JPY "25,000"
 * parses as 25), so canonical text wants `minorToDecimalString`.
 */
export function bare(minor: number, currency: CurrencyCode): string {
  return formatMinor(minor, currency, { showCurrency: false });
}

/** A bill line's figure. It arrives as the model's own string; one that isn't a figure survives as is. */
export function priced(amount: string, currency: CurrencyCode): string {
  try { return bare(parseMinor(amount, currency), currency); } catch { return amount; }
}

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

export function splitFooter(
  check: SplitValidation,
  currency: CurrencyCode,
): { ok: boolean; text: string } | null {
  if (check.problem === "empty") return { ok: false, text: copy.split.nobody };
  // 0 of 0 is satisfied but meaningless; the amount field says what's missing.
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

export function payerProblemText(
  check: PayerValidation, currency: CurrencyCode, voice: Voice = "expense",
): string | null {
  if (check.ok) return null;
  // "€40.00 still unaccounted for" wouldn't say the table is empty.
  if (check.problem === "empty") return copy.payers.nobody[voice];
  return shortfallText(check, currency, { under: copy.payers.under, over: copy.payers.over });
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Never `slice(0, 1)`: it splits an emoji's surrogate pair. */
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

/** Graphemes. The who-had-what headings set its column width. */
const CODE_MAX = 3;

/**
 * The shortest prefix that tells everyone apart ("Jo"/"Ja"), up to
 * `CODE_MAX`; whoever still collides is numbered per prefix: "Ma1 Ma2 Ju1".
 * A group with a digit in any name gets bare prefixes, repeats and all, since
 * "ba1" would equal "Ba" numbered 1.
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
  const numbered = !members.some((m) => /[0-9]/.test(m.name));
  if (!numbered) {
    for (const m of left) out.set(m.id, prefix(m.id, CODE_MAX));
    return out;
  }
  const code = (id: string, i: number) => {
    const n = String(i + 1);
    const room = CODE_MAX - n.length;
    return (room > 0 ? prefix(id, room) : "") + n;
  };
  // Runs by the prefix a one-digit code leaves room for: "Martin" and "Matteo" are both "Ma".
  const runs = new Map<string, string[]>();
  for (const m of left) {
    const key = prefix(m.id, CODE_MAX - 1);
    runs.set(key, [...(runs.get(key) ?? []), m.id]);
  }
  const codes = new Map<string, string>();
  for (const ids of runs.values()) ids.forEach((id, i) => codes.set(id, code(id, i)));
  // Ten in a run needs two digits, which can shorten a prefix into another
  // run's. Distinct numbers across all leftovers can't collide.
  if (new Set(codes.values()).size < codes.size) {
    left.forEach((m, i) => codes.set(m.id, code(m.id, i)));
  }
  for (const [id, c] of codes) out.set(id, c);
  return out;
}

const DAY = 86_400_000;

/** By the local calendar, not 24-hour spans. */
function nearDay(ts: number, now: number): string | null {
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(ts)) / DAY);
  return days === 0 ? copy.time.today : days === 1 ? copy.time.yesterday : null;
}

/** "Today" / "Yesterday" / "Sat 5 April" — the ledger's day rule. */
export function dayLabel(ts: number, now = Date.now()): string {
  const near = nearDay(ts, now);
  if (near) return near;
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

/** "Today · 18:22", or the day alone for a `dateOnly` entry. */
export function whenLabel(entry: Whenever, now = Date.now()): string {
  return entry.dateOnly
    ? dayLabel(entry.occurredAt, now)
    : `${dayLabel(entry.occurredAt, now)} · ${clockTime(entry.occurredAt)}`;
}

interface Whenever {
  occurredAt: number;
  dateOnly?: boolean | null;
  createdAt?: number | null;
}

/**
 * Newest day first; inside a day, `dateOnly` entries (the time is missing, not
 * early), then latest first, ties broken by `createdAt`.
 */
export function byWhen(a: Whenever, b: Whenever): number {
  const day = startOfLocalDay(b.occurredAt) - startOfLocalDay(a.occurredAt);
  if (day !== 0) return day;
  if (!a.dateOnly !== !b.dateOnly) return a.dateOnly ? -1 : 1;
  const time = a.dateOnly ? 0 : b.occurredAt - a.occurredAt;
  return time || ((b.createdAt ?? b.occurredAt) - (a.createdAt ?? a.occurredAt));
}

/** "FRI 4 APRIL · 18:22", or "TODAY · …" as the ledger says it. */
export function stamp(ts: number, now = Date.now()): string {
  const date = nearDay(ts, now)
    ?? new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(new Date(ts));
  return `${date.toUpperCase()} · ${clockTime(ts)}`;
}

/** "3 changes". */
export function plural(n: number, noun: Noun): string {
  return `${n} ${n === 1 ? noun.one : noun.many}`;
}

/** "2026-04-04", local time. */
export function dateInputValue(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight. Never `Date.parse`: it reads a bare date as UTC, the day before west of Greenwich. */
export function dayStart(day: string): number {
  const ymd = parseDay(day);
  return ymd ? new Date(ymd[0], ymd[1] - 1, ymd[2]).getTime() : Number.NaN;
}

function parseDay(day: string): [number, number, number] | null {
  const [y, m, d] = day.split("-").map(Number);
  return y && m && d ? [y, m, d] : null;
}

/** Keeps the time of day. */
export function withDate(ts: number, value: string): number {
  const ymd = parseDay(value);
  if (!ymd) return ts;
  const out = new Date(ts);
  out.setFullYear(ymd[0], ymd[1] - 1, ymd[2]);
  return out.getTime();
}

/** "2", "1/2", "1 1/2", or null for one. A slash: ½ ⅓ ¼ are unreadable at this size. */
export function countText(count: { n: number; d: number }): string | null {
  if (count.d <= 0 || count.n <= 0) return null;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(count.n, count.d) || 1;
  const [n, d] = [count.n / g, count.d / g];
  const whole = Math.floor(n / d);
  const rest = n - whole * d;
  if (rest === 0) return whole === 1 ? null : String(whole);
  return whole === 0 ? `${rest}/${d}` : `${whole} ${rest}/${d}`;
}
