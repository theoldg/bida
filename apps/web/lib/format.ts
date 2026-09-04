import { formatMinor, type CurrencyCode, type PayerValidation, type SplitValidation } from "@hajsik/core";
import { copy, type Noun } from "./copy";

/**
 * Display helpers. Money formatting itself lives in core — this file only
 * decides *which* of core's formats a given bit of chrome wants; the words
 * around the figures come from `lib/copy.ts`.
 */

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
): { ok: boolean; text: string } {
  if (check.problem === "empty") return { ok: false, text: copy.split.nobody };
  if (check.totalMinor <= 0) return { ok: false, text: copy.split.noTotal };
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
export function payerProblemText(check: PayerValidation, currency: CurrencyCode): string | null {
  if (check.ok) return null;
  // "Nobody" needs the words, not the figure: the shortfall is the whole
  // amount, and "€40.00 still unaccounted for" doesn't say the table is empty.
  if (check.problem === "empty") return copy.payers.nobody;
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
 * The shortest prefix of each name that tells everyone apart — "John" and
 * "Jane" become "Jo"/"Ja" rather than colliding on "J". Grows a letter at a
 * time until every id has a unique prefix; two people with the identical name
 * fall back to the name in full.
 */
export function distinctInitials(members: { id: string; name: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  const chars = new Map(members.map((m) => [m.id, graphemes(m.name.trim())]));
  const maxLen = Math.max(1, ...[...chars.values()].map((g) => g.length));
  for (let len = 1; len <= maxLen; len++) {
    const byPrefix = new Map<string, string[]>();
    for (const m of members) {
      if (out.has(m.id)) continue;
      const prefix = chars.get(m.id)!.slice(0, len).join("") || copy.unknown;
      byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), m.id]);
    }
    for (const [prefix, ids] of byPrefix) {
      if (ids.length === 1) out.set(ids[0]!, prefix);
    }
  }
  for (const m of members) if (!out.has(m.id)) out.set(m.id, m.name.trim() || copy.unknown);
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
