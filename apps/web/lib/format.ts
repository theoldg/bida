import { formatMinor, type CurrencyCode } from "@hajsik/core";

/**
 * Display helpers. Money formatting itself lives in core — this file only
 * decides *which* of core's formats a given bit of chrome wants.
 */

export function money(minor: number, currency: CurrencyCode, signed = false): string {
  return formatMinor(minor, currency, { signDisplay: signed ? "always" : "auto" });
}

/** Bare figure, no symbol — for the keypad and for columns with their own header. */
export function bare(minor: number, currency: CurrencyCode): string {
  return formatMinor(minor, currency, { showCurrency: false });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)).toUpperCase();
}

/** Six ledger-paper tones; the member's stored colorSeed picks one, forever. */
export function tone(colorSeed: number): string {
  return `a-${Math.abs(colorSeed) % 6}`;
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
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
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
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 2 * DAY) return "yesterday";
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)}d ago`;
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

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
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
