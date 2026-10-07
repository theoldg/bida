import { convertMinor, exponentOf, isValidRate, type CurrencyCode, type Rate } from "./money.js";
import { resolvePayers } from "./payers.js";
import { FNV_OFFSET, fnv1a, resolveEntrySplit, resolveSplit } from "./split.js";
import type { PlannedEntry, PlannedTransfer } from "./import.js";
import type { EntryRateSource, Id, SplitSpec } from "./types.js";

/**
 * How a planned row is written: which currency, at what rate, split how. The
 * plan holds the source's figures in the base currency and the checksum has
 * passed on them, so **every shape here is verified to resolve back to exactly
 * those figures** — through `resolveEntrySplit` and `resolvePayers`, which
 * `computeBalances` asks — or it is not used. Whatever is picked, the balances
 * the import approved stand to the cent.
 *
 * Preference: the currency it was spent in, then `shares` (the parts the
 * source split by), `equal`, `exact`.
 *
 * **The leftover cent is the hard part.** `equal` and `shares` hand it out by
 * `hash32("<entryId>:<memberId>")`, smallest first — and the entry id isn't
 * chosen yet, so `seedFor` searches for one that puts the cents where the
 * source did. Odds are 1/C(n, k) per id, so each search is capped in time and
 * a miss falls through to the next mode.
 *
 * **A CSV row in another currency is the exception**: its figures are in that
 * currency and the base ones don't exist until a rate does, so there is
 * nothing in base to match. It is written in its own currency at the rate for
 * its day — Evenly when its shares are, Amounts otherwise — and the file's
 * checksum, in that currency, is what vouched for it.
 */

/** Per search. Past it, the entry falls through to the next mode: `exact` always fits. */
const SEARCH_MS = 5;

/** A UUID's last group: twelve random hex digits, the part the search varies. */
const TAIL = 12;

/** A rate for a currency on a day, and where it came from. */
export interface DayRate {
  rate: Rate;
  source: EntryRateSource;
}

/** The rates `ratesWanted` asked for, by currency and day. */
export type RateFor = (currency: CurrencyCode, day: string) => DayRate | undefined;

interface ShapeOptions {
  newId: () => Id;
  /** Milliseconds, any origin: `performance.now`. Core takes the clock as an argument. */
  now: () => number;
  /** Needed only by a row with its own `currency`. */
  rateFor?: RateFor;
}

export interface EntryShape {
  id: Id;
  currency: CurrencyCode;
  amountMinor: number;
  rateToBase: Rate;
  /** Null in the base currency. */
  rateSource: EntryRateSource | null;
  split: SplitSpec;
  /** In `currency`, summing to `amountMinor`. */
  payers: Record<Id, number>;
}

interface Money {
  currency: CurrencyCode;
  amountMinor: number;
  rate: Rate;
}

/** A split to try: the spec, and the weights its base figures are distributed by (none for a base `exact`). */
interface Candidate {
  split: SplitSpec;
  weights?: Record<Id, number>;
}

/** A plan's entry as written. `idOf` maps the plan's names to member ids. */
export function shapeEntry(
  e: PlannedEntry,
  base: CurrencyCode,
  idOf: (name: string) => Id,
  options: ShapeOptions,
): EntryShape {
  const owed = byId(e.owed, idOf);
  const paid = byId(e.paid, idOf);
  if (e.currency && e.currency !== base) return priced(e, e.currency, owed, paid, options);
  // Parts all alike are Evenly, which says so plainer.
  const parts = e.parts && new Set(Object.values(e.parts)).size > 1 ? byId(e.parts, idOf) : undefined;
  const localOwed = e.local?.owed ? byId(e.local.owed, idOf) : undefined;
  const ones = Object.fromEntries(Object.keys(owed).map((id) => [id, 1]));

  const monies: Money[] = [];
  const foreign = foreignMoney(e.local, e.amountMinor, base);
  // A co-paid foreign entry would need its payers' cents placed too; none comes from a tricount.
  if (foreign && Object.keys(paid).length === 1) monies.push(foreign);
  monies.push({ currency: base, amountMinor: e.amountMinor, rate: "1" });

  for (const money of monies) {
    const inBase = money.rate === "1";
    const payers = inBase ? paid : { [Object.keys(paid)[0]!]: money.amountMinor };
    const exact = inBase ? owed : exactIn(money, owed, localOwed);
    const candidates: Candidate[] = [
      ...(parts ? [{ split: { mode: "shares", weights: parts } as const, weights: parts }] : []),
      { split: { mode: "equal", members: Object.keys(owed).sort() }, weights: ones },
      { split: { mode: "exact", amounts: exact }, weights: inBase ? undefined : exact },
    ];
    for (const { split, weights } of candidates) {
      const id = weights
        ? seedFor(e.amountMinor, weights, owed, options)
        : options.newId();
      if (id !== undefined && fits(id, money, e.amountMinor, split, payers, owed, paid)) {
        return {
          id,
          currency: money.currency,
          amountMinor: money.amountMinor,
          rateToBase: money.rate,
          rateSource: inBase ? null : "imported",
          split,
          payers,
        };
      }
    }
  }
  // A base `exact` resolves to its own amounts under any id: unreachable unless the plan doesn't add up.
  throw new RangeError(`shapeEntry: line ${e.line} does not add up`);
}

/** A plan's transfer as written: in the currency it was sent in, when a rate reproduces the base figure. */
export function shapeTransfer(t: PlannedTransfer, base: CurrencyCode, rateFor?: RateFor): {
  currency: CurrencyCode; amountMinor: number; rateToBase: Rate; rateSource: EntryRateSource | null;
} {
  if (t.currency && t.currency !== base) {
    const { rate, source } = rateOf(t.currency, t.day, t.line, rateFor);
    return { currency: t.currency, amountMinor: t.amountMinor, rateToBase: rate, rateSource: source };
  }
  const foreign = foreignMoney(t.local, t.amountMinor, base);
  return foreign
    ? { currency: foreign.currency, amountMinor: foreign.amountMinor, rateToBase: foreign.rate, rateSource: "imported" }
    : { currency: base, amountMinor: t.amountMinor, rateToBase: "1", rateSource: null };
}

/** A row whose figures are in another currency, at the rate for its day. */
function priced(
  e: PlannedEntry,
  currency: CurrencyCode,
  owed: Record<Id, number>,
  paid: Record<Id, number>,
  { newId, rateFor }: ShapeOptions,
): EntryShape {
  const { rate, source } = rateOf(currency, e.day, e.line, rateFor);
  const shares = Object.values(owed);
  // Even to the cent in its own currency; the base cents are the app's to place, as on any foreign entry.
  const even = shares.length > 0 && Math.max(...shares) - Math.min(...shares) <= 1;
  return {
    id: newId(),
    currency,
    amountMinor: e.amountMinor,
    rateToBase: rate,
    rateSource: source,
    split: even ? { mode: "equal", members: Object.keys(owed).sort() } : { mode: "exact", amounts: owed },
    payers: paid,
  };
}

function rateOf(currency: CurrencyCode, day: string, line: number, rateFor?: RateFor): DayRate {
  const found = rateFor?.(currency, day);
  if (!found || !isValidRate(found.rate)) {
    throw new RangeError(`line ${line}: no rate for ${currency} on ${day}`);
  }
  return found;
}

/**
 * An id under which `resolveSplit(total, shares by weights, seed id)` gives
 * exactly `target`, or undefined when none can or none was found in time.
 *
 * Largest remainder hands the leftover units out by remainder first, so most
 * of the answer is settled before the seed is read: only members whose
 * remainders tie at the boundary are ordered by it. Those the source gave a
 * unit (`chosen`) must all rank before those it didn't (`passed`).
 *
 * The rank hashes `"<id>:<memberId>"` left to right, so a UUID is fixed but
 * for its last twelve hex digits, the state up to them hashed once, and each
 * candidate costs a few dozen steps per member — stopping at the first that
 * ranks out of place.
 */
export function seedFor(
  totalMinor: number,
  weights: Record<Id, number>,
  target: Record<Id, number>,
  { newId, now }: ShapeOptions,
): Id | undefined {
  const ids = Object.keys(weights).filter((id) => (weights[id] ?? 0) > 0).sort();
  if (ids.length === 0 || totalMinor <= 0) return undefined;
  if (!Object.keys(target).every((id) => ids.includes(id))) return undefined;

  const total = BigInt(totalMinor);
  const weightSum = ids.reduce((a, id) => a + BigInt(weights[id]!), 0n);
  const rows = ids.map((id) => {
    const exact = total * BigInt(weights[id]!);
    const floor = Number(exact / weightSum);
    return { id, rem: exact % weightSum, extra: (target[id] ?? 0) - floor };
  });
  if (rows.some((r) => r.extra !== 0 && r.extra !== 1)) return undefined;
  const leftover = rows.filter((r) => r.extra === 1).length;
  if (leftover === 0) return newId();

  // The remainder the last unit goes at. Above it everybody gets one, below it nobody.
  const byRem = [...rows].sort((a, b) => (a.rem === b.rem ? 0 : a.rem > b.rem ? -1 : 1));
  const boundary = byRem[leftover - 1]!.rem;
  for (const r of rows) {
    if (r.rem > boundary && r.extra !== 1) return undefined;
    if (r.rem < boundary && r.extra !== 0) return undefined;
  }
  const tied = rows.filter((r) => r.rem === boundary);
  const chosen = tied.filter((r) => r.extra === 1).map((r) => r.id);
  const passed = tied.filter((r) => r.extra === 0).map((r) => r.id);
  if (passed.length === 0) return newId();

  const start = newId();
  const head = start.slice(0, -TAIL);
  if (!/^[0-9a-f]{12}$/.test(start.slice(-TAIL))) return undefined;
  const headState = fnv1a(FNV_OFFSET, head);
  let tail = parseInt(start.slice(-TAIL), 16);
  const deadline = now() + SEARCH_MS;

  for (let i = 0; ; i++) {
    if ((i & 255) === 255 && now() > deadline) return undefined;
    tail = (tail + 1) % 2 ** 48;
    const ending = tail.toString(16).padStart(TAIL, "0");
    const state = fnv1a(headState, `${ending}:`);
    // The last of the chosen, as `distribute` sorts: rank, then id.
    let lastRank = -1;
    let lastId = "";
    for (const id of chosen) {
      const rank = fnv1a(state, id);
      if (rank > lastRank || (rank === lastRank && id > lastId)) {
        lastRank = rank;
        lastId = id;
      }
    }
    let ok = true;
    for (const id of passed) {
      const rank = fnv1a(state, id);
      if (rank < lastRank || (rank === lastRank && id < lastId)) {
        ok = false;
        break;
      }
    }
    if (ok) return head + ending;
  }
}

function byId(byName: Record<string, number>, idOf: (name: string) => Id): Record<Id, number> {
  const out: Record<Id, number> = {};
  for (const [name, minor] of Object.entries(byName)) {
    const id = idOf(name);
    if (minor !== 0) out[id] = (out[id] ?? 0) + minor;
  }
  return out;
}

/** The spent currency at a rate that converts it to the base figure exactly, or undefined. */
function foreignMoney(
  local: PlannedEntry["local"],
  baseMinor: number,
  base: CurrencyCode,
): Money | undefined {
  if (!local || local.currency === base) return undefined;
  const rate = rateReproducing(local.amountMinor, local.currency, baseMinor, base, local.rate);
  return rate === undefined ? undefined : { currency: local.currency, amountMinor: local.amountMinor, rate };
}

/**
 * A rate taking `localMinor` to exactly `baseMinor` under `convertMinor`: the
 * source's own when it does, else the shortest decimal that does. The base
 * figure is re-derived from the rate on every read, so one that misses by a
 * cent would move a balance.
 */
export function rateReproducing(
  localMinor: number,
  local: CurrencyCode,
  baseMinor: number,
  base: CurrencyCode,
  hint?: string | null,
): Rate | undefined {
  if (!Number.isSafeInteger(localMinor) || !Number.isSafeInteger(baseMinor)) return undefined;
  if (localMinor <= 0 || baseMinor <= 0) return undefined;
  const reproduces = (r: string) => isValidRate(r) && convertMinor(localMinor, local, base, r) === baseMinor;
  const given = hint?.trim();
  if (given && reproduces(given)) return given;

  // rate = (baseMinor / 10^eb) / (localMinor / 10^el), to `d` decimal places.
  const shift = exponentOf(local) - exponentOf(base);
  for (let d = 0; d <= 24; d++) {
    let numer = BigInt(baseMinor);
    let denom = BigInt(localMinor);
    const k = shift + d;
    if (k >= 0) numer *= 10n ** BigInt(k);
    else denom *= 10n ** BigInt(-k);
    const scaled = (numer * 2n + denom) / (denom * 2n);
    if (scaled <= 0n) continue;
    const digits = scaled.toString().padStart(d + 1, "0");
    const rate = trimDecimal(d === 0 ? digits : `${digits.slice(0, -d)}.${digits.slice(-d)}`);
    if (reproduces(rate)) return rate;
  }
  return undefined;
}

function trimDecimal(text: string): string {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/**
 * An `exact` split's amounts in a foreign currency: the source's own, when it
 * states them and they add up, else the base shares apportioned. Fixed here,
 * not seeded — the seed is then found for the base figures they apportion.
 */
function exactIn(
  m: Money,
  owed: Record<Id, number>,
  localOwed: Record<Id, number> | undefined,
): Record<Id, number> {
  if (localOwed && sum(localOwed) === m.amountMinor
    && Object.keys(owed).every((id) => (localOwed[id] ?? 0) > 0)) return localOwed;
  return nonZero(resolveSplit(m.amountMinor, { mode: "shares", weights: owed }).shares);
}

/** Whether this shape reads back as exactly the source's figures, as `computeBalances` reads it. */
function fits(
  id: Id,
  m: Money,
  baseMinor: number,
  split: SplitSpec,
  payers: Record<Id, number>,
  owed: Record<Id, number>,
  paid: Record<Id, number>,
): boolean {
  const entry = {
    id,
    amountMinor: m.amountMinor,
    baseAmountMinor: baseMinor,
    split,
    paidBy: Object.keys(payers)[0]!,
    payers,
  };
  try {
    return same(nonZero(resolveEntrySplit(entry).shares), owed)
      && same(nonZero(resolvePayers(entry)), paid);
  } catch {
    return false;
  }
}

function nonZero(map: Record<Id, number>): Record<Id, number> {
  const out: Record<Id, number> = {};
  for (const [k, v] of Object.entries(map)) if (v !== 0) out[k] = v;
  return out;
}

function sum(map: Record<Id, number>): number {
  return Object.values(map).reduce((a, b) => a + b, 0);
}

function same(a: Record<Id, number>, b: Record<Id, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && b[k] === a[k]);
}
