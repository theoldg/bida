/**
 * Hybrid logical clocks.
 *
 * Phone wall clocks are wrong, sometimes by minutes. Ordering the op log by
 * wall time would let a device with a slow clock silently lose every conflict.
 * An HLC pairs physical time with a counter so that ordering stays sane even
 * when clocks disagree, and stays total thanks to a per-device tiebreak.
 *
 * The string form is fixed-width and zero-padded so that lexicographic string
 * comparison IS the ordering. Never parse it to compare.
 * See docs/sync.md#ordering-hybrid-logical-clocks.
 */

export type Hlc = string;

const PHYSICAL_DIGITS = 15;
const COUNTER_DIGITS = 5;
const MAX_COUNTER = 10 ** COUNTER_DIGITS - 1;
/** Reject clocks this far ahead of us; a device that wrong corrupts ordering. */
export const MAX_CLOCK_DRIFT_MS = 60 * 60 * 1000;

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
  const m = /^(\d{15})-(\d{5})-([0-9a-z]{1,16})$/.exec(hlc);
  if (!m) throw new RangeError(`malformed hlc: ${JSON.stringify(hlc)}`);
  return { physical: Number(m[1]), counter: Number(m[2]), node: m[3]! };
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

/** Stamp a locally-created op. Returns the new state and the stamp. */
export function hlcSend(state: HlcState, now: number): { state: HlcState; hlc: Hlc } {
  const physical = Math.max(state.physical, Math.trunc(now));
  const counter = physical === state.physical ? state.counter + 1 : 0;
  if (counter > MAX_COUNTER) throw new RangeError("hlc counter overflow");
  const next: HlcState = { physical, counter, node: state.node };
  return { state: next, hlc: formatHlc(next) };
}

/** Advance the local clock on receiving a remote stamp. */
export function hlcReceive(state: HlcState, remote: Hlc, now: number): HlcState {
  const r = parseHlc(remote);
  const wall = Math.trunc(now);
  if (r.physical - wall > MAX_CLOCK_DRIFT_MS) {
    throw new RangeError(
      `hlc from the future by ${r.physical - wall}ms; refusing to adopt it`,
    );
  }
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
  if (counter > MAX_COUNTER) throw new RangeError("hlc counter overflow");
  return { physical, counter, node: state.node };
}
