import {
  formatMinor, formatRate, parseMinor, startOfLocalDay,
  type CurrencyCode, type PayerValidation, type Rate, type SplitValidation,
} from "@bida/core";
import { copy, type Noun, type Voice } from "./copy";

/**
 * Display helpers: which of core's money formats a bit of chrome wants. The
 * words around the figures come from `lib/copy.ts`.
 */

/**
 * The thousands mark wherever this app writes a figure itself: a narrow
 * no-break space. A comma and a point are each somebody's decimal separator;
 * a space is nobody's, so stripping it on parse can't eat a meant character.
 */
export const GROUP = "\u202f";

/**
 * "4800.5" -> "4 800.5". Display only; never stored, never parsed. For
 * what you are typing into an amount field, and rates; read amounts are
 * `money()` and `bare()`, which are `Intl`-grouped.
 */
export function groupDigits(canonical: string): string {
  const [whole = "", frac] = canonical.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

/**
 * A rate as every screen shows one: exact decimal text, thousands grouped
 * ("1 EUR = 13 000 UZS").
 */
export function rateText(rate: Rate, digits?: number): string {
  return groupDigits(digits === undefined ? formatRate(rate) : formatRate(rate, digits));
}

export function money(minor: number, currency: CurrencyCode, signed = false): string {
  return formatMinor(minor, currency, { signDisplay: signed ? "always" : "auto" });
}

/**
 * The tip screen's dollars only. `money()` uses the reader's locale, which
 * outside the US renders "US$1.25" under a hand-written `$5`; pinned to en-US.
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
 * A bill line's figure, as the grid prints it.
 *
 * **What arrives is the model's own string, not a number** — `readBill` keeps
 * it verbatim so `checkScan` can show an unreadable one (`core/scan.ts`). So
 * "10" beside "39.00" is reformatted here; a string that isn't a figure
 * survives as it is.
 */
export function priced(amount: string, currency: CurrencyCode): string {
  try { return bare(parseMinor(amount, currency), currency); } catch { return amount; }
}

/**
 * The "this doesn't add up" sentence for the split and payer editors. Core
 * returns minor units and a code, not knowing the currency.
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
 * The split editor's bottom line: `shortfallText`, plus two verdicts that need
 * the total itself:
 *
 * - **Nobody included yet** — say that, not a figure.
 * - **Nothing to divide** — `validateSplit` calls 0 of 0 satisfied, which is
 *   nonsense under a blank amount. Caught here once rather than at each call.
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
 * Why the payer side can't be saved, or `null` when it can. The same sentence
 * on the payers screen and beside the form's payer field.
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
 * What a rejected promise says to a person. A non-`Error` is stringified
 * rather than dropped.
 */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * What a person *sees* as one character. **Never `slice(0, 1)`**: UTF-16 code
 * units split an emoji's surrogate pair into a replacement box.
 * `Intl.Segmenter` counts what the font draws; code points are the fallback.
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
 * The shortest prefix of each name that tells everyone apart ("Jo"/"Ja", not
 * "J"/"J"), never past three graphemes: whoever still collides is numbered
 * ("Ba1", "Ba2"). The number restarts per shared prefix: "Ma1 Ma2 Ju1 Ju2".
 *
 * So no name may contain a digit: "ba1" would equal "Ba" numbered 1, and a
 * group holding one takes the bare prefixes, repeats and all. The "Who was
 * there" chips carry the full names.
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
  if (!numbered) {
    for (const m of left) out.set(m.id, prefix(m.id, CODE_MAX));
    return out;
  }
  const code = (id: string, i: number) => {
    const n = String(i + 1);
    const room = CODE_MAX - n.length;
    return (room > 0 ? prefix(id, room) : "") + n;
  };
  // Numbered within each run that will *print* the same prefix — two
  // graphemes, the width a one-digit code leaves. So "Martin"/"Marta" and
  // "Matteo"/"Matilda" number as one "Ma" run (Ma1..Ma4), and "Ju" restarts.
  const runs = new Map<string, string[]>();
  for (const m of left) {
    const key = prefix(m.id, CODE_MAX - 1);
    runs.set(key, [...(runs.get(key) ?? []), m.id]);
  }
  const codes = new Map<string, string>();
  for (const ids of runs.values()) ids.forEach((id, i) => codes.set(id, code(id, i)));
  // Ten in one run needs two digits, which cuts the prefix short enough to equal
  // another run's. Numbering across every leftover can't collide: no name holds
  // a digit, so distinct numbers mean distinct codes.
  if (new Set(codes.values()).size < codes.size) {
    left.forEach((m, i) => codes.set(m.id, code(m.id, i)));
  }
  for (const [id, c] of codes) out.set(id, c);
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
 * "Today · 18:22" — or the day alone for a `dateOnly` entry, where a clock
 * would print a 00:00 nobody read off a receipt.
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
 * The ledger's order: newest day first; inside a day, `dateOnly` entries (the
 * time is missing, not early), then by time, latest first. `createdAt` breaks
 * ties so backdated entries keep a stable order; `occurredAt` stands in where
 * it is absent.
 */
export function byWhen(a: Whenever, b: Whenever): number {
  const day = startOfLocalDay(b.occurredAt) - startOfLocalDay(a.occurredAt);
  if (day !== 0) return day;
  if (!a.dateOnly !== !b.dateOnly) return a.dateOnly ? -1 : 1;
  const time = a.dateOnly ? 0 : b.occurredAt - a.occurredAt;
  return time || ((b.createdAt ?? b.occurredAt) - (a.createdAt ?? a.occurredAt));
}

/**
 * "FRI 4 APRIL · 18:22" — the history timeline's stamp. "TODAY" and
 * "YESTERDAY" as the ledger's day rule says them, since the two sit together.
 */
export function stamp(ts: number, now = Date.now()): string {
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(ts)) / DAY);
  const date = days === 0 ? copy.time.today
    : days === 1 ? copy.time.yesterday
    : new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(new Date(ts));
  return `${date.toUpperCase()} · ${clockTime(ts)}`;
}

/**
 * "3 changes". The noun is a `{ one, many }` pair from `lib/copy.ts` — plurals
 * are the translation's business.
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
 * The inverse of `dateInputValue`: local midnight of a `YYYY-MM-DD` day
 * (docs/data-model.md). **Never `Date.parse`**: it reads a bare date as UTC,
 * the day before for anyone west of Greenwich.
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
 * exactly one. A slash rather than ½ ⅓ ¼, whose glyphs are unreadable at this
 * size.
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
