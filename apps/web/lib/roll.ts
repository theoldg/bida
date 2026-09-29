import { formatMinorParts, type CurrencyCode } from "@bida/core";

/**
 * The balance card's roll (components/rolling-figure.tsx): an old figure and a
 * new one, glyph against glyph, and the figure this phone last drew for each
 * group, so reopening one can roll from it.
 */

/** Each changed digit's slide, and the gap before the next one starts. */
export const ROLL_MS = 800;
export const ROLL_GAP = 100;
/** The ledger is on screen this long before a figure it opened with moves. */
export const ROLL_BEAT = 250;

/** One cell of the figure: what it was, what it becomes, and its place in the cascade. */
export interface Glyph {
  from: string;
  to: string;
  /** The how-manyth changed glyph from the left; null for one that stays. */
  order: number | null;
}

export interface Roll {
  /** The currency and whatever the locale puts beside it: never rolled. */
  pre: string;
  glyphs: Glyph[];
  post: string;
  /** A bigger figure rolls up, a smaller one down — whichever side of zero. */
  up: boolean;
  /** How many glyphs change. */
  changed: number;
}

interface Pieces { pre: string; whole: string[]; fraction: string[]; post: string }

function pieces(minor: number, currency: CurrencyCode, locale?: string): Pieces {
  const out: Pieces = { pre: "", whole: [], fraction: [], post: "" };
  let num = false;
  for (const { type, value } of formatMinorParts(minor, currency, { locale })) {
    if (type === "integer" || type === "group") { num = true; out.whole.push(...value); }
    else if (type === "decimal" || type === "fraction") { num = true; out.fraction.push(...value); }
    else if (num) out.post += value;
    else out.pre += value;
  }
  return out;
}

/**
 * Line up two unsigned figures: the whole part by its right edge, so units sit
 * over units and a figure gaining a digit grows on the left, and the fraction
 * by its left. A glyph one side lacks is "" — a cell opening or closing.
 * Null when there is nothing to roll.
 */
export function planRoll(from: number, to: number, currency: CurrencyCode, locale?: string): Roll | null {
  if (from === to) return null;
  const a = pieces(from, currency, locale);
  const b = pieces(to, currency, locale);
  // The same currency always formats the same around its digits; this only
  // guards a locale that places them differently by magnitude.
  if (a.pre !== b.pre || a.post !== b.post || a.fraction.length !== b.fraction.length) return null;
  const n = Math.max(a.whole.length, b.whole.length);
  const pad = (xs: string[]) => [...Array<string>(n - xs.length).fill(""), ...xs];
  const aw = pad(a.whole), bw = pad(b.whole);
  let changed = 0;
  const glyphs = [...aw.map((c, i) => [c, bw[i]!] as const), ...a.fraction.map((c, i) => [c, b.fraction[i]!] as const)]
    .map(([f, t]): Glyph => ({ from: f, to: t, order: f === t ? null : changed++ }));
  return { pre: b.pre, glyphs, post: b.post, up: to > from, changed };
}

/** From the first glyph moving to the last one landing. */
export function rollTime(roll: Roll): number {
  return ROLL_MS + Math.max(0, roll.changed - 1) * ROLL_GAP;
}

// ------------------------------------------------------------- the last figure drawn

/**
 * `{ [groupId]: [net, currency] }`. localStorage rather than Dexie because the
 * card has to know it on its first render: read after paint, the new figure
 * would show, jump back and roll. Erased with the group (lib/db/commands/groups.ts).
 */
const KEY = "bida.shown";

type Shown = Record<string, [number, string]>;

function readAll(): Shown {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed as Shown : {};
  } catch {
    return {};
  }
}

/** The net this phone last drew for the group, if it was in this currency. */
export function shownBefore(groupId: string, currency: string): number | null {
  const kept = readAll()[groupId];
  return Array.isArray(kept) && kept[1] === currency && Number.isInteger(kept[0]) ? kept[0] : null;
}

export function keepShown(groupId: string, net: number, currency: string): void {
  const all = readAll();
  const kept = all[groupId];
  if (kept && kept[0] === net && kept[1] === currency) return;
  all[groupId] = [net, currency];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode: no roll on reopen */ }
}

export function forgetShown(groupId: string): void {
  const all = readAll();
  if (!(groupId in all)) return;
  delete all[groupId];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* nothing to undo */ }
}
