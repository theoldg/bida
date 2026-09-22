/**
 * Hybrid logical clocks: wall time plus a counter, so a phone with a slow clock
 * doesn't lose every conflict, with a per-device tiebreak for a total order.
 * The string is fixed-width so string comparison IS the order — never parse it
 * to compare. docs/sync.md#ordering-hybrid-logical-clocks.
 */

export type Hlc = string;

const PHYSICAL_DIGITS = 15;
const COUNTER_DIGITS = 5;
const MAX_COUNTER = 10 ** COUNTER_DIGITS - 1;

/**
 * The furthest-ahead stamp accepted at all (year 5138): anything past it is
 * corruption or craft, refused by `isHlc`. It leaves a spare digit so `tick`'s
 * carry can't overflow the string width.
 */
const MAX_PHYSICAL = 10 ** 14 - 1;
const HLC_PATTERN = /^(\d{15})-(\d{5})-([0-9a-z]{1,16})$/;

/**
 * How far ahead of the wall clock a stamp may be and still be taken. A day
 * covers any honest skew but stops a phone set to 2099 pinning every clock it
 * meets. A stamp past it waits (`isAhead`) until the wall is within a day.
 */
export const MAX_DRIFT_MS = 24 * 3600_000;

export interface HlcState {
  physical: number;
  counter: number;
  node: string;
}

export function createHlcState(node: string, physical = 0, counter = 0): HlcState {
  if (!/^[0-9a-z]{1,16}$/.test(node)) {
    throw new RangeError(`hlc node must be 1-16 lowercase alphanumerics, got ${node}`);
  }
  return { physical, counter, node };
}

export function formatHlc(state: HlcState): Hlc {
  return [
    String(state.physical).padStart(PHYSICAL_DIGITS, "0"),
    String(state.counter).padStart(COUNTER_DIGITS, "0"),
    state.node,
  ].join("-");
}

export function parseHlc(hlc: Hlc): HlcState {
  const m = HLC_PATTERN.exec(hlc);
  if (!m) throw new RangeError(`malformed hlc: ${JSON.stringify(hlc)}`);
  return { physical: Number(m[1]), counter: Number(m[2]), node: m[3]! };
}

/**
 * Whether an untrusted stamp has exactly `formatHlc`'s shape and is within
 * `MAX_PHYSICAL`. A failing stamp must reach neither `hlcReceive` nor the fold,
 * where `"zzz"` would win every conflict.
 */
export function isHlc(value: string): boolean {
  const m = HLC_PATTERN.exec(value);
  return m !== null && Number(m[1]) <= MAX_PHYSICAL;
}

/**
 * Whether a stamp is more than `MAX_DRIFT_MS` ahead of `now`, so must not be
 * folded or adopted yet. Checked on arrival, not in `validateOp`, because the
 * answer depends on when it's asked.
 */
export function isAhead(hlc: Hlc, now: number): boolean {
  return parseHlc(hlc).physical > Math.trunc(now) + MAX_DRIFT_MS;
}

/**
 * This phone's clock, reset to the wall if it is past the drift bound (a stamp
 * adopted before the bound existed, or a since-corrected wall clock) — else
 * every op it stamps would be refused by peers.
 */
function reined(state: HlcState, wall: number): HlcState {
  return state.physical > wall + MAX_DRIFT_MS ? { physical: wall, counter: 0, node: state.node } : state;
}

/** Total order. Lexicographic on the string form, which is the point of it. */
export function compareHlc(a: Hlc, b: Hlc): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxHlc(a: Hlc | undefined, b: Hlc | undefined): Hlc | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return compareHlc(a, b) >= 0 ? a : b;
}

/**
 * A full counter carries into the millisecond instead of throwing: `(p + 1, 0)`
 * still sorts after `(p, n)`. A throw would stop the phone writing for good.
 */
function tick(physical: number, counter: number, node: string): HlcState {
  return counter > MAX_COUNTER
    ? { physical: physical + 1, counter: 0, node }
    : { physical, counter, node };
}

/** Stamp a locally-created op. Returns the new state and the stamp. */
export function hlcSend(current: HlcState, now: number): { state: HlcState; hlc: Hlc } {
  const state = reined(current, Math.trunc(now));
  const physical = Math.max(state.physical, Math.trunc(now));
  const counter = physical === state.physical ? state.counter + 1 : 0;
  const next = tick(physical, counter, state.node);
  return { state: next, hlc: formatHlc(next) };
}

/**
 * Advance the local clock on receiving a remote stamp, so this device stamps
 * after what it has seen. A stamp past `MAX_DRIFT_MS` should be held back by
 * the caller (`isAhead`); if one arrives anyway it isn't adopted.
 */
export function hlcReceive(current: HlcState, remote: Hlc, now: number): HlcState {
  const wall = Math.trunc(now);
  const state = reined(current, wall);
  if (isAhead(remote, wall)) return state;
  const r = parseHlc(remote);
  const physical = Math.max(state.physical, r.physical, wall);
  let counter: number;
  if (physical === state.physical && physical === r.physical) {
    counter = Math.max(state.counter, r.counter) + 1;
  } else if (physical === state.physical) {
    counter = state.counter + 1;
  } else if (physical === r.physical) {
    counter = r.counter + 1;
  } else {
    counter = 0;
  }
  return tick(physical, counter, state.node);
}
