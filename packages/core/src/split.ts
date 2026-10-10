import type { ArithmeticSplit, ArithmeticMode, Id, SplitSpec } from "./types.js";

/**
 * Splitting. Shares sum to the total exactly, and the result is identical on
 * every device — hence largest-remainder with a seeded pure tiebreak, never
 * object iteration order.
 */

interface SplitResult {
  /** memberId -> minor units. Sums to the total. */
  shares: Record<Id, number>;
  /** Members handed an extra minor unit. Diagnostic only; the UI never shows it. */
  remainderAbsorbedBy: Id[];
}

/**
 * Why a split doesn't add up. Core names the problem and never formats it:
 * it doesn't know the currency, so the sentence is the caller's.
 */
export type SplitProblem = "empty" | "under" | "over" | "percent" | "nothingLeft";

export interface SplitValidation {
  ok: boolean;
  /** What the spec currently allocates, for the "€170,39 of €170,39" banner. */
  allocatedMinor: number;
  totalMinor: number;
  problem?: SplitProblem;
  /** Unallocated minor units; negative when the split is over the total. */
  diffMinor?: number;
  /** A fallback sentence for callers with no currency to hand. */
  message?: string;
  /** An `exact` split's rows sharing what is left, and how much that is. */
  rest?: { ids: Id[]; leftMinor: number };
}

export class SplitError extends Error {}

interface SplitOptions {
  /**
   * Rotates who absorbs leftover minor units, so the same person doesn't
   * subsidise every split. Pass the expense id. Invisible in the UI.
   */
  tiebreakSeed?: string;
}

/** FNV-1a's starting state. */
export const FNV_OFFSET = 0x811c9dc5;

/**
 * FNV-1a, carried on from state `h` through `input`. Small, fast, and identical
 * everywhere — which is all we need. Exported so `import-shape.ts` can hash a
 * seed's prefix once and every candidate ending from there.
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
 * Members named by a spec, always sorted, always deduplicated. **In an `exact`
 * split a typed zero is nobody**: typing 0 clears a figure, so a zero reads as
 * out here too, whatever wrote it. Being in with no figure is `rest`.
 */
export function splitParticipants(spec: SplitSpec): Id[] {
  const ids =
    spec.mode === "equal" ? spec.members
    : spec.mode === "exact" ? [...Object.keys(exactAmounts(spec.amounts)), ...restOf(spec)]
    : spec.mode === "shares" || spec.mode === "receipt" ? Object.keys(spec.weights)
    : Object.keys(spec.bps);
  return [...new Set(ids)].sort();
}

/**
 * An exact split's amounts with the zeros dropped — the only shape one is
 * built in. Converting hands someone a zero when the total is zero or has
 * fewer minor units than people, and a kept zero would read as "in".
 */
function exactAmounts(amounts: Record<Id, number>): Record<Id, number> {
  const out: Record<Id, number> = {};
  for (const [id, v] of Object.entries(amounts)) if (v !== 0) out[id] = v;
  return out;
}

/** An exact split's rows sharing what is left: sorted, deduplicated, and empty for every other mode. */
export function restOf(spec: SplitSpec): Id[] {
  return spec.mode === "exact" && spec.rest ? [...new Set(spec.rest)].sort() : [];
}

/** The figures somebody typed — `amounts` less the rest's, which are only ever a filled-in copy. */
function typedAmounts(spec: SplitSpec & { mode: "exact" }): Record<Id, number> {
  const rest = new Set(spec.rest ?? []);
  const out: Record<Id, number> = {};
  for (const [id, v] of Object.entries(exactAmounts(spec.amounts))) if (!rest.has(id)) out[id] = v;
  return out;
}

/**
 * Every row's figure in an exact split: the typed ones as typed, and what they
 * leave of `totalMinor` divided evenly among the rest, seeded as Evenly is.
 * With nothing left (or less than one minor unit each) the rest get zeros;
 * `validateSplit` refuses that, and over the total nobody is handed a negative.
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
 * The exact split as it is written: the rest's figures filled in against this
 * total, so the stored `amounts` sum to it for any reader. Zeros stay out of
 * `amounts` (a zero is nobody) but in `rest`. Anything else is handed back.
 */
export function settleRest<S extends SplitSpec>(totalMinor: number, spec: S, options: SplitOptions = {}): S {
  if (spec.mode !== "exact" || restOf(spec).length === 0) return spec;
  const amounts = exactAmounts(exactFigures(totalMinor, spec, options));
  return { mode: "exact", amounts, rest: restOf(spec) } as S;
}

/** The same map, keyed in sorted order. */
function sortedKeys<T>(map: Record<Id, T>): Record<Id, T> {
  const out: Record<Id, T> = {};
  for (const id of Object.keys(map).sort()) out[id] = map[id] as T;
  return out;
}

/**
 * The split in canonical form: members sorted and deduplicated, maps keyed in
 * order. Lets anything downstream tell "nobody moved" from "somebody re-picked
 * the same people" by serialising.
 */
export function canonicalSplit(spec: SplitSpec): SplitSpec {
  switch (spec.mode) {
    case "equal": return { mode: "equal", members: splitParticipants(spec) };
    case "shares": return { mode: "shares", weights: sortedKeys(spec.weights) };
    case "exact": {
      // No `rest` key when nobody floats, so every split written before it
      // serialises as it always did.
      const rest = restOf(spec);
      return rest.length > 0
        ? { mode: "exact", amounts: sortedKeys(spec.amounts), rest }
        : { mode: "exact", amounts: sortedKeys(spec.amounts) };
    }
    case "percent": return { mode: "percent", bps: sortedKeys(spec.bps) };
    case "receipt": return { mode: "receipt", weights: sortedKeys(spec.weights) };
  }
}

/** Positive weight per participant, whatever the mode calls it. */
function weightsOf(spec: SplitSpec, participants: Id[]): Map<Id, bigint> {
  const out = new Map<Id, bigint>();
  for (const id of participants) {
    let w: number;
    switch (spec.mode) {
      case "equal": w = 1; break;
      case "shares": case "receipt": w = spec.weights[id] ?? 0; break;
      case "percent": w = spec.bps[id] ?? 0; break;
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
 * Distribute `total` across weighted participants using the largest-remainder
 * method. Deterministic: ties break by `hash32("<seed>:<memberId>")`, smallest
 * first, then by member id — by member id alone when there is no seed.
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

  // Hand out the leftover minor units, biggest fractional part first.
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

/**
 * Resolve a split spec into per-member minor amounts summing exactly to
 * `totalMinor`. Throws if the spec cannot produce that.
 */
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

/** The fields of an entry its split is read against — everything the two below need. */
interface SplitBearing {
  id: Id;
  amountMinor: number;
  baseAmountMinor: number;
  split: SplitSpec;
}

/**
 * An entry's shares in BASE currency, summing to `baseAmountMinor`. **Ask this,
 * never `resolveSplit` on an entry**: an `exact` split is typed in the entry's
 * own currency, as its payers are, and apportions the base total by those
 * amounts at read time — with the entry id as seed, so the cent a conversion
 * leaves lands where every device puts it.
 *
 * An entry written before that held base amounts. They sum to `baseAmountMinor`
 * instead, and the same apportioning hands them back unchanged; one entry in
 * the base currency reads the same either way.
 */
export function resolveEntrySplit(entry: SplitBearing): SplitResult {
  const seed = { tiebreakSeed: entry.id };
  if (entry.split.mode !== "exact") return resolveSplit(entry.baseAmountMinor, entry.split, seed);
  // The rest's figures are worked out again rather than trusted: the same
  // total and seed give the same cents as were written.
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

/**
 * The split as its editor shows it: an `exact` one in the entry's own currency.
 * A pre-change entry's base amounts are apportioned back over `amountMinor`
 * (see `resolveEntrySplit`); anything else is handed over as it is.
 */
export function ownCurrencySplit<S extends SplitSpec>(entry: SplitBearing & { split: S }): S {
  const split: SplitSpec = entry.split;
  // A split with a rest was only ever written in the entry's own currency.
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

/** An exact split's total, validated as `resolveSplit` would. */
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

/** Non-throwing check, so the UI can render a half-finished split. */
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
    // Somebody in the split with nothing to share is a row saying "in" over a
    // zero: refused, rather than quietly dropping them.
    if (leftMinor < ids.length) {
      return {
        ok: false, allocatedMinor: typed, totalMinor, problem: "nothingLeft", diffMinor: leftMinor,
        message: "Nothing is left for whoever shares the rest", rest: { ids, leftMinor },
      };
    }
    return { ok: true, allocatedMinor: totalMinor, totalMinor, rest: { ids, leftMinor } };
  }

  if (spec.mode === "percent") {
    const sum = participants.reduce((a, id) => a + (spec.bps[id] ?? 0), 0);
    if (sum !== 10_000) {
      return {
        ok: false,
        allocatedMinor: 0,
        totalMinor,
        problem: "percent",
        message: `Percentages add up to ${(sum / 100).toFixed(2)}%, not 100%`,
      };
    }
  }

  try {
    // It sums to the total or it throws.
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

/**
 * Typed amounts against the total they must make — an exact split's shares,
 * and the payers' contributions (payers.ts). Both are the same "€12 still to
 * place" or "€3 too many", so they are one check.
 */
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

/** Convenience: what one member owes for one expense. 0 if not involved. */
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
 * Switch tabs carrying who is in and none of the numbers: parts are not
 * amounts, and a figure nobody typed is not one. Into As amounts everyone
 * shares the rest, so typing one figure re-divides the others. Never into
 * `receipt` (ADR-0016) or the legacy `percent`, which nobody types.
 */
export function convertSplitMode(
  spec: SplitSpec,
  mode: Exclude<ArithmeticMode, "percent">,
): ArithmeticSplit {
  if (spec.mode === mode) return spec as ArithmeticSplit;
  const participants = splitParticipants(spec);
  switch (mode) {
    case "equal": return { mode: "equal", members: participants };
    // No `rest` key when nobody is in, as `canonicalSplit` writes it.
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
 * The split editor's head box: everyone in takes everyone out; otherwise it
 * brings in whoever is out and leaves what the others hold alone — a 2 in
 * parts stays a 2, a typed amount stays typed. In `exact` the newcomers join
 * the rest, even with nothing left, where `validateSplit` says so.
 */
export function toggleEveryone(
  spec: Exclude<ArithmeticSplit, { mode: "percent" }>,
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
 * Rewrite a legacy receipt expense (`shares` plus `splitTab: "receipt"`, or
 * `shares` beside a scanned bill) into `receipt` mode. Runs in `applyPatch`,
 * so every reader sees one shape. Mutates in place. ADR-0016.
 */
export function upgradeReceiptSplit(entity: Record<string, unknown>): void {
  const spec = entity["split"] as SplitSpec | undefined;
  const tab = entity["splitTab"];
  if (tab !== undefined) delete entity["splitTab"];
  if (spec?.mode !== "shares") return;
  const items = entity["receiptItems"];
  if (!Array.isArray(items) || items.length === 0) return;
  if (tab !== undefined && tab !== null && tab !== "receipt") return;
  entity["split"] = { mode: "receipt", weights: spec.weights };
}
