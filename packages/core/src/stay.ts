// Doc: docs/data-model.md#splits--the-only-tricky-arithmetic
import type { DaysSplit, Id, StayUnit } from "./types";

/**
 * A split by days: a rental's every night (or day) costs the same, and each is
 * shared evenly by whoever was there that night — so a night three people
 * share costs each of them more than a night five do.
 *
 * Money never meets a fraction here. Over every row, a person's weight is
 * Σ L / heads, where L is the lowest common multiple of the rows' head counts:
 * an integer, and the exact proportion of the total that is theirs. The split
 * itself is then the one largest-remainder `shares` already does, rounded once
 * over the whole stay rather than a cent at a time per night.
 */

/** A year: past it a typo in a date field, not a stay. */
export const MAX_STAY = 366;

const DAY_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function utc(iso: string): number | null {
  if (!ISO.test(iso)) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

/** `iso` plus `n` days, as a calendar date: never a local clock's. */
export function addDays(iso: string, n: number): string {
  const t = utc(iso);
  if (t === null) return iso;
  return new Date(t + n * DAY_MS).toISOString().slice(0, 10);
}

/** Days from `a` to `b`, or null for a date that isn't one. */
export function daysBetween(a: string, b: string): number | null {
  const x = utc(a), y = utc(b);
  return x === null || y === null ? null : Math.round((y - x) / DAY_MS);
}

/** Whether the spec is one a reader can trust at all; a broken one names nobody. */
export function stayShapeOk(spec: DaysSplit): boolean {
  return utc(spec.from) !== null && Number.isInteger(spec.count)
    && spec.count >= 1 && spec.count <= MAX_STAY && (spec.unit === "night" || spec.unit === "day");
}

/** Row `i` of one person's string. A short or garbled string is away, never a throw. */
export function stayAt(spec: DaysSplit, id: Id, row: number): boolean {
  return spec.stays[id]?.[row] === "1";
}

/** The calendar date of each row, `from` onwards. */
export function stayDates(spec: DaysSplit): string[] {
  if (!stayShapeOk(spec)) return [];
  return Array.from({ length: spec.count }, (_, i) => addDays(spec.from, i));
}

/**
 * The date the range's second field shows: the morning you leave for nights,
 * the last day itself for days — what a booking says either way.
 */
export function stayEnd(spec: Pick<DaysSplit, "unit" | "from" | "count">): string {
  return addDays(spec.from, spec.unit === "night" ? spec.count : spec.count - 1);
}

/** Who has at least one row, sorted. */
export function stayers(spec: DaysSplit): Id[] {
  if (!stayShapeOk(spec)) return [];
  return Object.keys(spec.stays)
    .filter((id) => spec.stays[id]!.slice(0, spec.count).includes("1"))
    .sort();
}

/** Who was there on `day`, or null where the stay doesn't reach it. */
export function stayersOn(spec: DaysSplit, day: string): Id[] | null {
  const row = daysBetween(spec.from, day);
  if (!stayShapeOk(spec) || row === null || row < 0 || row >= spec.count) return null;
  return stayers(spec).filter((id) => stayAt(spec, id, row));
}

/** How many rows each person was there. */
export function stayCount(spec: DaysSplit, id: Id): number {
  let n = 0;
  for (let i = 0; i < spec.count; i++) if (stayAt(spec, id, i)) n++;
  return n;
}

/** How many people were there on each row. */
export function stayHeads(spec: DaysSplit): number[] {
  const ids = stayers(spec);
  return Array.from({ length: stayShapeOk(spec) ? spec.count : 0 },
    (_, i) => ids.filter((id) => stayAt(spec, id, i)).length);
}

/** The rows nobody was there: their share has nobody to pay it. */
export function emptyStayRows(spec: DaysSplit): number[] {
  return stayHeads(spec).flatMap((h, i) => (h === 0 ? [i] : []));
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Integer weights in the exact proportion of the stay each person owes. Rows
 * nobody was at are left out — `resolveSplit` refuses such a stay before it
 * gets here. Null when the common multiple outgrows a safe integer, which takes
 * dozens of people with every head count among them.
 */
export function stayWeights(spec: DaysSplit): Record<Id, number> | null {
  const ids = stayers(spec);
  const heads = stayHeads(spec);
  let l = 1;
  for (const h of new Set(heads)) {
    if (h === 0) continue;
    l = (l / gcd(l, h)) * h;
    if (!Number.isSafeInteger(l * spec.count)) return null;
  }
  const weights: Record<Id, number> = {};
  for (const id of ids) {
    let w = 0;
    heads.forEach((h, i) => { if (h > 0 && stayAt(spec, id, i)) w += l / h; });
    weights[id] = w;
  }
  // Smallest terms, so what history and the CSV compare stays short.
  const g = Object.values(weights).reduce((a, w) => gcd(a, w), 0);
  if (g > 1) for (const id of ids) weights[id] = weights[id]! / g;
  return weights;
}

/** Everyone in `ids` there every row. */
export function seedStay(from: string, unit: StayUnit, count: number, ids: readonly Id[]): DaysSplit {
  const n = Math.min(MAX_STAY, Math.max(1, count));
  const stays: Record<Id, string> = {};
  for (const id of [...ids].sort()) stays[id] = "1".repeat(n);
  return { mode: "days", unit, from, count: n, stays };
}

function rows(spec: DaysSplit, id: Id): boolean[] {
  return Array.from({ length: spec.count }, (_, i) => stayAt(spec, id, i));
}

function written(spec: DaysSplit, id: Id, there: boolean[]): DaysSplit {
  return { ...spec, stays: { ...spec.stays, [id]: there.map((b) => (b ? "1" : "0")).join("") } };
}

/** One row of one person, flipped. */
export function toggleStayRow(spec: DaysSplit, id: Id, row: number): DaysSplit {
  if (row < 0 || row >= spec.count) return spec;
  const there = rows(spec, id);
  there[row] = !there[row];
  return written(spec, id, there);
}

/** One person there on rows `first`..`last` and no other: their dates, typed. */
export function setStayRun(spec: DaysSplit, id: Id, first: number, last: number): DaysSplit {
  const a = Math.max(0, Math.min(first, last)), b = Math.min(spec.count - 1, Math.max(first, last));
  return written(spec, id, Array.from({ length: spec.count }, (_, i) => i >= a && i <= b));
}

/** Everyone there every row, or nobody: a person in or out of the stay. */
export function setStayAll(spec: DaysSplit, id: Id, there: boolean): DaysSplit {
  if (there) return written(spec, id, Array(spec.count).fill(true));
  const stays = { ...spec.stays };
  delete stays[id];
  return { ...spec, stays };
}

/**
 * The run of rows through `row` a person is there for, or null where they
 * aren't: what an end of their bar drags.
 */
export function stayRunAt(spec: DaysSplit, id: Id, row: number): { first: number; last: number } | null {
  if (!stayAt(spec, id, row)) return null;
  let first = row, last = row;
  while (first > 0 && stayAt(spec, id, first - 1)) first--;
  while (last < spec.count - 1 && stayAt(spec, id, last + 1)) last++;
  return { first, last };
}

/**
 * A run's end moved to `to`: grown over whatever lies between, or shrunk with
 * the rows it leaves becoming away. The other end stays put, and never crosses.
 */
export function dragStayEnd(
  spec: DaysSplit, id: Id, run: { first: number; last: number }, end: "first" | "last", to: number,
): DaysSplit {
  const there = rows(spec, id);
  for (let i = run.first; i <= run.last; i++) there[i] = false;
  const a = end === "first" ? Math.min(Math.max(0, to), run.last) : run.first;
  const b = end === "last" ? Math.max(Math.min(spec.count - 1, to), run.first) : run.last;
  for (let i = a; i <= b; i++) there[i] = true;
  return written(spec, id, there);
}

/**
 * The same stay over new dates. Rows still in range keep who was there; a row
 * added at either end copies the row it grows from, so somebody who arrived
 * late doesn't arrive early as the start moves back — or, `"away"`, has nobody,
 * for a range grown to fit one person's dates.
 */
export function restay(
  spec: DaysSplit, from: string, end: string, unit: StayUnit = spec.unit, grown: "edge" | "away" = "edge",
): DaysSplit | null {
  const shift = daysBetween(spec.from, from);
  const span = daysBetween(from, end);
  if (shift === null || span === null) return null;
  const count = unit === "night" ? span : span + 1;
  if (count < 1 || count > MAX_STAY) return null;
  const stays: Record<Id, string> = {};
  for (const id of Object.keys(spec.stays)) {
    const was = rows(spec, id);
    stays[id] = Array.from({ length: count }, (_, i) => {
      const at = i + shift;
      if (grown === "away" && (at < 0 || at >= spec.count)) return "0";
      return was[Math.min(spec.count - 1, Math.max(0, at))] ? "1" : "0";
    }).join("");
  }
  return { mode: "days", unit, from, count, stays };
}

/** One person's nights that a given number shared: "3 nights ÷ 4", and what they cost. */
export interface StayLine {
  heads: number;
  count: number;
  /** What one head paid one of these rows, to the minor unit: the calendar's caption. */
  each: number;
  /** `count × each`, exactly, so the line can be checked by hand. */
  minor: number;
}

/**
 * A person's share, written out as the sum it is: their rows grouped by how
 * many were there, each group `count × each` with `each` the rounded figure
 * the calendar prints under those rows. Most crowded first — the cheapest
 * nights lead. What the lines miss of the `shares` the split gave them is
 * `rounding`, said rather than hidden in a line: the split rounds once over the
 * whole stay, so a night three share costs one of them a cent less.
 */
export function stayLines(
  total: number, spec: DaysSplit, shares: Record<Id, number>,
): Record<Id, { lines: StayLine[]; rounding: number }> {
  const heads = stayHeads(spec);
  const out: Record<Id, { lines: StayLine[]; rounding: number }> = {};
  if (heads.length === 0) return out;
  for (const id of stayers(spec)) {
    const by = new Map<number, number>();
    heads.forEach((h, i) => { if (h > 0 && stayAt(spec, id, i)) by.set(h, (by.get(h) ?? 0) + 1); });
    const lines = [...by].sort(([a], [b]) => b - a).map(([h, count]) => {
      const each = Math.round(total / (spec.count * h));
      return { heads: h, count, each, minor: count * each };
    });
    out[id] = { lines, rounding: (shares[id] ?? 0) - lines.reduce((a, l) => a + l.minor, 0) };
  }
  return out;
}
