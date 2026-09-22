import { describe, expect, it } from "vitest";
import {
  compareHlc, createHlcState, formatHlc, hlcReceive, hlcSend, isHlc, maxHlc, parseHlc,
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

  // There is no time limit on an update. Refusing a far-future stamp lost
  // somebody's expense to protect an ordering guarantee that adopting it
  // provides anyway.
  it("adopts a clock absurdly far in the future rather than refusing it", () => {
    const state = createHlcState("aaa", 0, 0);
    const remote = formatHlc(createHlcState("bbb", 10 ** 12, 0));
    const next = hlcReceive(state, remote, 1000);
    expect(next.physical).toBe(10 ** 12);
    expect(compareHlc(hlcSend(next, 1000).hlc, remote)).toBe(1);
  });

  // A peer pinned far ahead means the wall clock never catches up, so every op
  // sent or received spends the counter. Running out used to throw, and a
  // phone that throws here can never write or sync again.
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
    // Far ahead is still a clock — somebody's phone set to 2099.
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
