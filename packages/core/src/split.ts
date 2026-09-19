import type { ArithmeticSplit, ArithmeticMode, Id, SplitSpec } from "./types.js";

/**
 * Splitting is the only genuinely tricky arithmetic in the app, and the one
 * place where being subtly wrong costs people real money.
 *
 * Two properties matter more than anything else:
 *   1. Shares sum to the total EXACTLY. Not approximately.
 *   2. The result is byte-identical on every device, so two phones folding the
 *      same ops never disagree about a balance.
 *
 * Property 2 is why remainders go by largest fractional part with a seeded,
 * pure-function tiebreak, and never by iteration order of an object.
 */

interface SplitResult {
  /** memberId -> minor units, in the expense's base currency. Sums to the total. */
  shares: Record<Id, number>;
  /**
   * Members handed an extra minor unit because the total wouldn't divide.
   * Diagnostic only — the UI deliberately never shows this.
   */
  remainderAbsorbedBy: Id[];
}

/**
 * Why a split doesn't add up, for a UI that has to say so in the group's own
 * currency. Core deliberately doesn't format money into these strings: it
 * knows minor units and nothing about the currency they're in, and a sentence
 * built here would read "230 minor units unallocated" on a screen where every
 * other figure says "€2.30". The number is the field; the sentence is the
 * caller's.
 */
export type SplitProblem = "empty" | "under" | "over" | "percent";

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
}

export class SplitError extends Error {}

interface SplitOptions {
  /**
   * Rotates who absorbs the leftover minor units.
   *
   * Without it, ties break by ascending member id and the same person
   * subsidises every single split in the group — over a two-week trip that is
   * a real, if small, systematic unfairness. Pass the expense id and the
   * burden moves around, while staying perfectly deterministic across devices.
   *
   * This is deliberately invisible: nothing in the UI announces who took the
   * cent. It's a fairness fix, not a feature.
   */
  tiebreakSeed?: string;
}

/** FNV-1a. Small, fast, and identical everywhere — which is all we need. */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Members named by a spec, always sorted, always deduplicated. */
export function splitParticipants(spec: SplitSpec): Id[] {
  const ids =
    spec.mode === "equal" ? spec.members
    : spec.mode === "exact" ? Object.keys(spec.amounts)
    : spec.mode === "shares" || spec.mode === "receipt" ? Object.keys(spec.weights)
    : Object.keys(spec.bps);
  return [...new Set(ids)].sort();
}

/** The same map, keyed in sorted order. */
function sortedKeys<T>(map: Record<Id, T>): Record<Id, T> {
  const out: Record<Id, T> = {};
  for (const id of Object.keys(map).sort()) out[id] = map[id] as T;
  return out;
}

/**
 * The same split written one way: members sorted and deduplicated, weight maps
 * keyed in sorted order.
 *
 * Two specs that mean the same thing then serialise the same, which is the
 * only way anything downstream can tell "nobody moved" from "somebody re-picked
 * the same people". Toggling a member out and straight back in reorders the
 * array, and that used to be written as an edit — the log then said "changed
 * who's involved" with the identical names on both lines, because the names
 * are what a person is shown and the order is not.
 */
export function canonicalSplit(spec: SplitSpec): SplitSpec {
  switch (spec.mode) {
    case "equal": return { mode: "equal", members: splitParticipants(spec) };
    case "shares": return { mode: "shares", weights: sortedKeys(spec.weights) };
    case "exact": return { mode: "exact", amounts: sortedKeys(spec.amounts) };
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
 * method. Deterministic: ties break by ascending member id.
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
    const shares: Record<Id, number> = {};
    let sum = 0;
    for (const id of participants) {
      const v = spec.amounts[id] ?? 0;
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

/**
 * Non-throwing check for the UI, which needs to render a half-finished split
 * without exploding. Drives the "€170,39 of €170,39 allocated" banner.
 */
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
    let sum = 0;
    for (const id of participants) sum += spec.amounts[id] ?? 0;
    if (sum === totalMinor) return { ok: true, allocatedMinor: sum, totalMinor };
    const diff = totalMinor - sum;
    return {
      ok: false,
      allocatedMinor: sum,
      totalMinor,
      problem: diff > 0 ? "under" : "over",
      diffMinor: diff,
      message: diff > 0 ? "Not all of it is allocated yet" : "That is more than the total",
    };
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
    const { shares } = resolveSplit(totalMinor, spec, options);
    const allocated = Object.values(shares).reduce((a, b) => a + b, 0);
    return { ok: allocated === totalMinor, allocatedMinor: allocated, totalMinor };
  } catch (err) {
    return {
      ok: false,
      allocatedMinor: 0,
      totalMinor,
      message: err instanceof Error ? err.message : String(err),
    };
  }
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
 * Switching modes should keep everyone's current amounts, not reset them.
 *
 * Only into a mode somebody types: a receipt's weights come from its bill and
 * from nowhere else, so there is no such thing as converting *to* one
 * (`ArithmeticMode`, ADR-0016).
 */
export function convertSplitMode(
  totalMinor: number,
  spec: SplitSpec,
  mode: ArithmeticMode,
  options: SplitOptions = {},
): ArithmeticSplit {
  if (spec.mode === mode) return spec as ArithmeticSplit;
  const participants = splitParticipants(spec);
  // Nobody included is a state the editor lets you sit in — zero everyone's
  // parts and the tabs must still switch. `exact` and `percent` reach it
  // through `resolveSplit`, which refuses an empty split rather than invent
  // one, so the empty spec is built here instead of thrown over.
  if (participants.length === 0) {
    switch (mode) {
      case "equal": return { mode: "equal", members: [] };
      case "exact": return { mode: "exact", amounts: {} };
      case "shares": return { mode: "shares", weights: {} };
      case "percent": return { mode: "percent", bps: {} };
    }
  }
  switch (mode) {
    case "equal":
      return { mode: "equal", members: participants };
    case "exact": {
      const { shares } = resolveSplit(totalMinor, spec, options);
      return { mode: "exact", amounts: shares };
    }
    case "shares": {
      const weights: Record<Id, number> = {};
      for (const id of participants) weights[id] = 1;
      return { mode: "shares", weights };
    }
    case "percent": {
      const { shares } = resolveSplit(totalMinor, spec, options);
      const bps: Record<Id, number> = {};
      if (totalMinor === 0) {
        // Nothing to apportion; fall back to even percentages.
        const each = Math.floor(10_000 / participants.length);
        for (const id of participants) bps[id] = each;
      } else {
        for (const id of participants) {
          bps[id] = Math.round(((shares[id] ?? 0) / totalMinor) * 10_000);
        }
      }
      // Force the rounding drift onto the largest holder so it still sums to 100%.
      const sum = participants.reduce((a, id) => a + (bps[id] ?? 0), 0);
      if (sum !== 10_000 && participants.length > 0) {
        const biggest = [...participants].sort(
          (a, b) => (bps[b] ?? 0) - (bps[a] ?? 0) || (a < b ? -1 : 1),
        )[0]!;
        bps[biggest] = (bps[biggest] ?? 0) + (10_000 - sum);
      }
      return { mode: "percent", bps };
    }
  }
}

/**
 * Bring an expense read off the op log up to the shape the app works in.
 *
 * A receipt split used to be written as `shares` beside a `splitTab: "receipt"`
 * flag, and everything that wanted to know what it was looking at had to read
 * both. That is over: a receipt is its own `SplitMode`, and this is the only
 * code left that knows the old shape. It runs where ops become state
 * (`applyPatch`), so every reader — the fold, the history — sees one shape and
 * nobody asks a second field. ADR-0016.
 *
 * An entry written before the flag existed has no tab to read, so a `shares`
 * split beside a scanned bill is one, which is what the flag was derived from
 * anyway. Mutates in place: it is folding, and the bag is the fold's own.
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
