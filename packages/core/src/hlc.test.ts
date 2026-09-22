import { describe, expect, it } from "vitest";
import {
  MAX_DRIFT_MS, compareHlc, createHlcState, formatHlc, hlcReceive, hlcSend, isAhead, isHlc,
  maxHlc, parseHlc,
} from "./hlc.js";

describe("hlc", () => {
  it("orders lexicographically, which is the whole point", () => {
    const a = formatHlc(createHlcState("aaa", 1000, 0));
    const b = formatHlc(createHlcState("aaa", 1000, 1));
    const c = formatHlc(createHlcState("aaa", 2000, 0));
    expect(compareHlc(a, b)).toBe(-1);
    expect(compareHlc(b, c)).toBe(-1);
    expect([c, a, b].sort()).toEqual([a, b, c]);
  });

  it("round-trips through parse", () => {
    const s = createHlcState("node1", 1724764800000, 7);
    expect(parseHlc(formatHlc(s))).toEqual(s);
  });

  it("increments the counter when the wall clock hasn't moved", () => {
    let state = createHlcState("aaa");
    const first = hlcSend(state, 1000);
    state = first.state;
    const second = hlcSend(state, 1000);
    expect(second.state.counter).toBe(1);
    expect(compareHlc(second.hlc, first.hlc)).toBe(1);
  });

  it("never goes backwards when the phone's clock does", () => {
    let state = createHlcState("aaa");
    const first = hlcSend(state, 5000);
    state = first.state;
    // clock jumps back two seconds
    const second = hlcSend(state, 3000);
    expect(second.state.physical).toBe(5000);
    expect(compareHlc(second.hlc, first.hlc)).toBe(1);
  });

  it("adopts a remote clock that is ahead, so its writes don't always win", () => {
    const state = createHlcState("aaa", 1000, 0);
    const remote = formatHlc(createHlcState("bbb", 9000, 3));
    const next = hlcReceive(state, remote, 1000);
    expect(next.physical).toBe(9000);
    expect(next.counter).toBe(4);
    // and our next send now sorts after the remote op
    expect(compareHlc(hlcSend(next, 1000).hlc, remote)).toBe(1);
  });

  // A fast phone is adopted; one in 2099 would pin every clock it met.
  it("adopts a stamp up to a day ahead and not one past it", () => {
    const now = 1_756_300_000_000;
    const state = createHlcState("aaa", now, 0);
    const fast = formatHlc(createHlcState("bbb", now + MAX_DRIFT_MS, 0));
    const future = formatHlc(createHlcState("bbb", 4_100_000_000_000, 0));

    expect(isAhead(fast, now)).toBe(false);
    expect(hlcReceive(state, fast, now).physical).toBe(now + MAX_DRIFT_MS);

    expect(isAhead(future, now)).toBe(true);
    expect(hlcReceive(state, future, now)).toEqual(state);
    // And a stamp stops being ahead once the wall has caught up with it.
    expect(isAhead(future, 4_100_000_000_000 - MAX_DRIFT_MS)).toBe(false);
  });

  // A clock past the bound would have every op refused by peers.
  it("brings its own clock back from beyond the bound to the wall", () => {
    const now = 1_756_300_000_000;
    const pinned = createHlcState("aaa", 4_100_000_000_000, 42);
    expect(hlcSend(pinned, now).state.physical).toBe(now);
    const remote = formatHlc(createHlcState("bbb", now - 5, 0));
    expect(hlcReceive(pinned, remote, now).physical).toBe(now);
  });

  // A peer pinned ahead keeps the counter spending; throwing on overflow would
  // stop the phone writing or syncing for good.
  it("carries a full counter into the millisecond instead of throwing", () => {
    const full = createHlcState("aaa", 5000, 99999);
    const sent = hlcSend(full, 1000);
    expect(sent.state).toMatchObject({ physical: 5001, counter: 0 });
    expect(compareHlc(sent.hlc, formatHlc(full))).toBe(1);

    const remote = formatHlc(createHlcState("bbb", 5000, 99999));
    const got = hlcReceive(createHlcState("aaa", 0, 0), remote, 1000);
    expect(got).toMatchObject({ physical: 5001, counter: 0 });
    expect(compareHlc(formatHlc(got), remote)).toBe(1);
  });

  it("knows a stamp it can adopt from one it cannot", () => {
    expect(isHlc(formatHlc(createHlcState("abc", 1756300000000, 7)))).toBe(true);
    // Shape and range only; "too far ahead" is `isAhead`'s question.
    expect(isHlc(formatHlc(createHlcState("abc", 4_100_000_000_000, 0)))).toBe(true);
    expect(isHlc(formatHlc(createHlcState("abc", 10 ** 14 - 1, 0)))).toBe(true);
    // Past the year 5138 it is not, and adopting it would run out of digits.
    expect(isHlc(formatHlc(createHlcState("abc", 10 ** 14, 0)))).toBe(false);
    expect(isHlc("999999999999999-99999-evil")).toBe(false);
    for (const bad of ["zzz", "", "000001756300000-00000-", "000001756300000-00000-ABC",
      "0000001756300000000-000000-abc123"]) {
      expect(isHlc(bad)).toBe(false);
    }
  });

  it("rejects malformed stamps and node ids", () => {
    expect(() => parseHlc("nope")).toThrow();
    expect(() => createHlcState("NOT-LOWER")).toThrow();
  });

  it("maxHlc handles absent sides", () => {
    const a = formatHlc(createHlcState("aaa", 1, 0));
    expect(maxHlc(undefined, a)).toBe(a);
    expect(maxHlc(a, undefined)).toBe(a);
  });
});
