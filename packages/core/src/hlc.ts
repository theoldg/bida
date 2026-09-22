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

/**
 * The furthest-ahead stamp a peer may hand us: the year 5138. No clock reads
 * that, however wrong — it is corruption or somebody's craft, and it is refused
 * at the door (`isHlc`, from `validateOp`) because it is the one kind of stamp
 * adopting could not survive. Below it, a whole digit of `physical` is spare,
 * so the counter carrying into it (`tick`) can never run the string past its
 * width.
 */
const MAX_PHYSICAL = 10 ** 14 - 1;
const HLC_PATTERN = /^(\d{15})-(\d{5})-([0-9a-z]{1,16})$/;

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
 * Whether a stamp from somewhere untrusted is one this clock can adopt: the
 * exact shape `formatHlc` writes, and no further ahead than `MAX_PHYSICAL`. A
 * stamp that fails this must reach neither `hlcReceive` nor the fold, where a
 * string like `"zzz"` would sort after every real stamp and win every conflict.
 */
export function isHlc(value: string): boolean {
  const m = HLC_PATTERN.exec(value);
  return m !== null && Number(m[1]) <= MAX_PHYSICAL;
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
 * A full counter carries into the millisecond rather than throwing: `(p + 1, 0)`
 * still sorts after every `(p, n)`, so ordering is untouched. A throw was a
 * phone that could never write again — once a far-ahead peer pins `physical`
 * the wall clock never catches up, and every op sent or received spends one of
 * the counter's hundred thousand.
 */
function tick(physical: number, counter: number, node: string): HlcState {
  return counter > MAX_COUNTER
    ? { physical: physical + 1, counter: 0, node }
    : { physical, counter, node };
}

/** Stamp a locally-created op. Returns the new state and the stamp. */
export function hlcSend(state: HlcState, now: number): { state: HlcState; hlc: Hlc } {
  const physical = Math.max(state.physical, Math.trunc(now));
  const counter = physical === state.physical ? state.counter + 1 : 0;
  const next = tick(physical, counter, state.node);
  return { state: next, hlc: formatHlc(next) };
}

/**
 * Advance the local clock on receiving a remote stamp.
 *
 * **Adopt every stamp, however far ahead it reads.** Refusing a far-future one
 * protects ordering by throwing away somebody's expense, and buys nothing:
 * adopting is itself the guarantee that a device stamps after what it has seen.
 * The one limit is `isHlc`'s, checked before a stamp gets here.
 */
export function hlcReceive(state: HlcState, remote: Hlc, now: number): HlcState {
  const r = parseHlc(remote);
  const wall = Math.trunc(now);
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
