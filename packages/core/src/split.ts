// Doc: docs/data-model.md#splits--the-only-tricky-arithmetic
import type { ArithmeticSplit, ArithmeticMode, Id, SplitSpec } from "./types.js";

/**
 * Shares sum to the total exactly, identically on every device — hence
 * largest-remainder with a seeded pure tiebreak, never object iteration order.
 */

interface SplitResult {
  shares: Record<Id, number>;
  /** Diagnostic only; the UI never shows it. */
  remainderAbsorbedBy: Id[];
}

/** Core names the problem and never formats it: it doesn't know the currency. */
export type SplitProblem = "empty" | "under" | "over" | "nothingLeft";

export interface SplitValidation {
  ok: boolean;
  allocatedMinor: number;
  totalMinor: number;
  problem?: SplitProblem;
  /** Negative when the split is over the total. */
  diffMinor?: number;
  message?: string;
  rest?: { ids: Id[]; leftMinor: number };
}

export class SplitError extends Error {}

interface SplitOptions {
  /** Rotates who absorbs leftover minor units. Pass the expense id. */
  tiebreakSeed?: string;
}

export const FNV_OFFSET = 0x811c9dc5;

/**
 * Carried on from state `h`, so `import-shape.ts` can hash a seed's prefix once.
 */
export function fnv1a(h: number, input: string): number {
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function hash32(input: string): number {
  return fnv1a(FNV_OFFSET, input);
}

/**
 * **In an `exact` split a typed zero is nobody**; being in with no figure is
 * `rest`.
 */
export function splitParticipants(spec: SplitSpec): Id[] {
  let ids: Id[];
  switch (spec.mode) {
    case "equal": ids = spec.members; break;
    case "exact": ids = [...Object.keys(exactAmounts(spec.amounts)), ...restOf(spec)]; break;
    case "shares": case "receipt": ids = Object.keys(spec.weights); break;
    // Names nobody, so `resolveSplit` refuses it rather than a screen throwing.
    default: ids = [];
  }
  return [...new Set(ids)].sort();
}

/** A kept zero would read as "in". */
function exactAmounts(amounts: Record<Id, number>): Record<Id, number> {
  const out: Record<Id, number> = {};
  for (const [id, v] of Object.entries(amounts)) if (v !== 0) out[id] = v;
  return out;
}

export function restOf(spec: SplitSpec): Id[] {
  return spec.mode === "exact" && spec.rest ? [...new Set(spec.rest)].sort() : [];
}

/** `amounts` less the rest's, which are only ever a filled-in copy. */
function typedAmounts(spec: SplitSpec & { mode: "exact" }): Record<Id, number> {
  const rest = new Set(spec.rest ?? []);
  const out: Record<Id, number> = {};
  for (const [id, v] of Object.entries(exactAmounts(spec.amounts))) if (!rest.has(id)) out[id] = v;
  return out;
}

/**
 * The rest share what the typed figures leave, seeded as Evenly is. Nobody is
 * handed a negative; `validateSplit` refuses what that leaves.
 */
export function exactFigures(
  totalMinor: number,
  spec: SplitSpec & { mode: "exact" },
  options: SplitOptions = {},
): Record<Id, number> {
  const typed = typedAmounts(spec);
  const rest = restOf(spec);
  if (rest.length === 0) return typed;
  const left = totalMinor - Object.values(typed).reduce((a, v) => a + v, 0);
  const out = { ...typed };
  for (const id of rest) out[id] = 0;
  if (left > 0) Object.assign(out, resolveSplit(left, { mode: "equal", members: rest }, options).shares);
  return out;
}

/**
 * Filled in against this total, so the stored `amounts` sum to it for any reader.
 */
export function settleRest<S extends SplitSpec>(totalMinor: number, spec: S, options: SplitOptions = {}): S {
  if (spec.mode !== "exact" || restOf(spec).length === 0) return spec;
  const amounts = exactAmounts(exactFigures(totalMinor, spec, options));
  return { mode: "exact", amounts, rest: restOf(spec) } as S;
}

function sortedKeys<T>(map: Record<Id, T>): Record<Id, T> {
  const out: Record<Id, T> = {};
  for (const id of Object.keys(map).sort()) out[id] = map[id] as T;
  return out;
}

/** Lets anything downstream tell "nobody moved" by serialising. */
export function canonicalSplit(spec: SplitSpec): SplitSpec {
  switch (spec.mode) {
    case "equal": return { mode: "equal", members: splitParticipants(spec) };
    case "shares": return { mode: "shares", weights: sortedKeys(spec.weights) };
    case "exact": {
      // No `rest` key when nobody floats, so older splits serialise as they
      // always did.
      const rest = restOf(spec);
      return rest.length > 0
        ? { mode: "exact", amounts: sortedKeys(spec.amounts), rest }
        : { mode: "exact", amounts: sortedKeys(spec.amounts) };
    }
    case "receipt": return { mode: "receipt", weights: sortedKeys(spec.weights) };
    default: return spec;
  }
}

function weightsOf(spec: SplitSpec, participants: Id[]): Map<Id, bigint> {
  const out = new Map<Id, bigint>();
  for (const id of participants) {
    let w: number;
    switch (spec.mode) {
      case "equal": w = 1; break;
      case "shares": case "receipt": w = spec.weights[id] ?? 0; break;
      case "exact": w = 0; break;
    }
    if (!Number.isInteger(w) || w < 0) {
      throw new SplitError(`weight for ${id} must be a non-negative integer, got ${w}`);
    }
    out.set(id, BigInt(w));
  }
  return out;
}

/**
 * Largest remainder. Ties break by `hash32("<seed>:<memberId>")`, then member id.
 */
function distribute(
  total: bigint,
  weights: Map<Id, bigint>,
  seed: string | undefined,
): SplitResult {
  const ids = [...weights.keys()].sort();
  const totalWeight = ids.reduce((a, id) => a + (weights.get(id) ?? 0n), 0n);
  if (totalWeight <= 0n) {
    throw new SplitError("split has no positive weights; nobody would owe anything");
  }

  const neg = total < 0n;
  const abs = neg ? -total : total;

  const shares: Record<Id, number> = {};
  const remainders: { id: Id; rem: bigint }[] = [];
  let allocated = 0n;

  for (const id of ids) {
    const w = weights.get(id) ?? 0n;
    const exact = abs * w;
    const floor = exact / totalWeight;
    shares[id] = Number(neg ? -floor : floor);
    allocated += floor;
    remainders.push({ id, rem: exact % totalWeight });
  }

  let leftover = abs - allocated;
  const rank = new Map<Id, number>(
    ids.map((id) => [id, seed === undefined ? 0 : hash32(`${seed}:${id}`)]),
  );
  remainders.sort((a, b) => {
    if (a.rem !== b.rem) return a.rem > b.rem ? -1 : 1;
    const ra = rank.get(a.id) ?? 0;
    const rb = rank.get(b.id) ?? 0;
    if (ra !== rb) return ra - rb;
    return a.id < b.id ? -1 : 1;
  });
  const remainderAbsorbedBy: Id[] = [];
  for (const { id } of remainders) {
    if (leftover <= 0n) break;
    shares[id] = (shares[id] ?? 0) + (neg ? -1 : 1);
    remainderAbsorbedBy.push(id);
    leftover -= 1n;
  }

  return { shares, remainderAbsorbedBy };
}

/** Throws if the spec cannot sum exactly to `totalMinor`. */
export function resolveSplit(
  totalMinor: number,
  spec: SplitSpec,
  options: SplitOptions = {},
): SplitResult {
  if (!Number.isSafeInteger(totalMinor)) {
    throw new SplitError(`total must be an integer of minor units, got ${totalMinor}`);
  }
  const participants = splitParticipants(spec);
  if (participants.length === 0) {
    throw new SplitError("split needs at least one participant");
  }

  if (spec.mode === "exact") {
    const figures = exactFigures(totalMinor, spec, options);
    const shares: Record<Id, number> = {};
    let sum = 0;
    for (const id of participants) {
      const v = figures[id] ?? 0;
      if (!Number.isSafeInteger(v)) {
        throw new SplitError(`exact amount for ${id} must be an integer, got ${v}`);
      }
      shares[id] = v;
      sum += v;
    }
    if (sum !== totalMinor) {
      throw new SplitError(
        `exact split allocates ${sum} but the expense is ${totalMinor}`,
      );
    }
    return { shares, remainderAbsorbedBy: [] };
  }

  if (totalMinor === 0) {
    const shares: Record<Id, number> = {};
    for (const id of participants) shares[id] = 0;
    return { shares, remainderAbsorbedBy: [] };
  }

  return distribute(BigInt(totalMinor), weightsOf(spec, participants), options.tiebreakSeed);
}

interface SplitBearing {
  id: Id;
  amountMinor: number;
  baseAmountMinor: number;
  split: SplitSpec;
}

/**
 * In BASE currency. **Ask this, never `resolveSplit` on an entry**: an `exact`
 * split is typed in the entry's own currency and apportions the base total at
 * read time, seeded by the entry id. Older entries held base amounts, which the
 * same apportioning hands back unchanged.
 */
export function resolveEntrySplit(entry: SplitBearing): SplitResult {
  const seed = { tiebreakSeed: entry.id };
  if (entry.split.mode !== "exact") return resolveSplit(entry.baseAmountMinor, entry.split, seed);
  // Worked out again rather than trusted: same total and seed, same cents.
  const split: SplitSpec = restOf(entry.split).length > 0
    ? { mode: "exact", amounts: exactFigures(entry.amountMinor, entry.split, seed) }
    : entry.split;
  const sum = exactSum(split.amounts);
  if (sum === entry.baseAmountMinor) return resolveSplit(entry.baseAmountMinor, split, seed);
  if (sum !== entry.amountMinor) {
    throw new SplitError(`exact split allocates ${sum} but the expense is ${entry.amountMinor}`);
  }
  return resolveSplit(entry.baseAmountMinor, { mode: "shares", weights: split.amounts }, seed);
}

/** An `exact` one in the entry's own currency, as its editor shows it. */
export function ownCurrencySplit<S extends SplitSpec>(entry: SplitBearing & { split: S }): S {
  const split: SplitSpec = entry.split;
  if (split.mode !== "exact" || restOf(split).length > 0) return entry.split;
  try {
    const sum = exactSum(split.amounts);
    if (sum === entry.amountMinor || sum !== entry.baseAmountMinor) return entry.split;
    const { shares } = resolveSplit(entry.amountMinor, { mode: "shares", weights: split.amounts }, {
      tiebreakSeed: entry.id,
    });
    return { mode: "exact", amounts: exactAmounts(shares) } as S;
  } catch {
    return entry.split;
  }
}

function exactSum(amounts: Record<Id, number>): number {
  let sum = 0;
  for (const [id, v] of Object.entries(amounts)) {
    if (!Number.isSafeInteger(v)) {
      throw new SplitError(`exact amount for ${id} must be an integer, got ${v}`);
    }
    sum += v;
  }
  return sum;
}

export function validateSplit(
  totalMinor: number,
  spec: SplitSpec,
  options: SplitOptions = {},
): SplitValidation {
  const participants = splitParticipants(spec);
  if (participants.length === 0) {
    return {
      ok: false, allocatedMinor: 0, totalMinor, problem: "empty",
      diffMinor: totalMinor, message: "Nobody is included yet",
    };
  }

  if (spec.mode === "exact") {
    const typed = Object.values(typedAmounts(spec)).reduce((a, v) => a + v, 0);
    const ids = restOf(spec);
    if (ids.length === 0) return addsUp(typed, totalMinor);
    const leftMinor = totalMinor - typed;
    if (leftMinor < 0) return { ...addsUp(typed, totalMinor), rest: { ids, leftMinor } };
    // A row saying "in" over a zero: refused, not quietly dropped.
    if (leftMinor < ids.length) {
      return {
        ok: false, allocatedMinor: typed, totalMinor, problem: "nothingLeft", diffMinor: leftMinor,
        message: "Nothing is left for whoever shares the rest", rest: { ids, leftMinor },
      };
    }
    return { ok: true, allocatedMinor: totalMinor, totalMinor, rest: { ids, leftMinor } };
  }

  try {
    resolveSplit(totalMinor, spec, options);
    return { ok: true, allocatedMinor: totalMinor, totalMinor };
  } catch (err) {
    return {
      ok: false,
      allocatedMinor: 0,
      totalMinor,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** An exact split's shares and the payers' contributions are one check. */
export function addsUp(sum: number, totalMinor: number) {
  if (sum === totalMinor) return { ok: true, allocatedMinor: sum, totalMinor };
  const diff = totalMinor - sum;
  return {
    ok: false,
    allocatedMinor: sum,
    totalMinor,
    problem: diff > 0 ? "under" as const : "over" as const,
    diffMinor: diff,
    message: diff > 0 ? "Some of it is still unaccounted for" : "That is more than the total",
  };
}

export function shareOf(
  totalMinor: number,
  spec: SplitSpec,
  memberId: Id,
  options: SplitOptions = {},
): number {
  if (!splitParticipants(spec).includes(memberId)) return 0;
  return resolveSplit(totalMinor, spec, options).shares[memberId] ?? 0;
}

/**
 * Carries who is in and none of the numbers: a figure nobody typed is not one.
 * Never into `receipt`, which nobody types (ADR-0016).
 */
export function convertSplitMode(spec: SplitSpec, mode: ArithmeticMode): ArithmeticSplit {
  if (spec.mode === mode) return spec as ArithmeticSplit;
  const participants = splitParticipants(spec);
  switch (mode) {
    case "equal": return { mode: "equal", members: participants };
    case "exact": return participants.length > 0
      ? { mode: "exact", amounts: {}, rest: participants }
      : { mode: "exact", amounts: {} };
    case "shares": {
      const weights: Record<Id, number> = {};
      for (const id of participants) weights[id] = 1;
      return { mode: "shares", weights };
    }
  }
}

/**
 * Everyone in takes everyone out; otherwise brings in whoever is out and leaves
 * what the others hold alone.
 */
export function toggleEveryone(
  spec: ArithmeticSplit,
  memberIds: readonly Id[],
): ArithmeticSplit {
  const inNow = new Set(splitParticipants(spec));
  const out = memberIds.filter((id) => !inNow.has(id));
  switch (spec.mode) {
    case "equal":
      return { mode: "equal", members: out.length === 0 ? [] : [...inNow, ...out] };
    case "shares": {
      if (out.length === 0) return { mode: "shares", weights: {} };
      const weights = { ...spec.weights };
      for (const id of out) weights[id] = 1;
      return { mode: "shares", weights };
    }
    case "exact":
      if (out.length === 0) return { mode: "exact", amounts: {} };
      return { mode: "exact", amounts: typedAmounts(spec), rest: [...restOf(spec), ...out].sort() };
  }
}

/**
 * Without it the fold reads parts typed beside a kept bill as a legacy receipt.
 */
export function partsBesideBill(
  entry: { split: SplitSpec; receiptItems?: readonly unknown[] | null },
): "shares" | null {
  return entry.split.mode === "shares" && (entry.receiptItems?.length ?? 0) > 0 ? "shares" : null;
}

/**
 * When `receipt` became a mode: an unflagged `shares` beside a bill stamped after
 * this is parts somebody typed, by a build that wrote no flag (to 97037e75).
 */
export const RECEIPT_MODE_SINCE = Date.UTC(2026, 8, 11, 8, 34);

/**
 * A legacy receipt expense into `receipt` mode, in `applyPatch`, so every reader
 * sees one shape. Mutates in place. ADR-0016.
 */
export function upgradeReceiptSplit(entity: Record<string, unknown>, writtenAt?: number): void {
  const spec = entity["split"] as SplitSpec | undefined;
  const tab = entity["splitTab"];
  if (tab !== undefined) delete entity["splitTab"];
  if (spec?.mode !== "shares") return;
  const items = entity["receiptItems"];
  if (!Array.isArray(items) || items.length === 0) return;
  if (tab !== undefined && tab !== null && tab !== "receipt") return;
  if (tab !== "receipt" && writtenAt !== undefined && writtenAt >= RECEIPT_MODE_SINCE) return;
  entity["split"] = { mode: "receipt", weights: spec.weights };
}
