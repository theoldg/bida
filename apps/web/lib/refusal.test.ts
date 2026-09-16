import { describe, expect, it } from "vitest";
import { flashClass, NOT_REFUSED, refused, staleFlashes, stillMissing, type Refusal } from "./refusal";

describe("a refusal's flash", () => {
  it("is nothing until something is refused", () => {
    expect(flashClass(NOT_REFUSED)).toBe("");
  });

  it("alternates its class, so a second refusal replays the animation", () => {
    const once = refused(NOT_REFUSED);
    const twice = refused(once);
    expect(flashClass(once)).toBe(" flash-a");
    expect(flashClass(twice)).toBe(" flash-b");
    expect(flashClass(refused(twice))).toBe(" flash-a");
  });

  it("comes off once it has run, whatever the count", () => {
    expect(flashClass({ ...refused(NOT_REFUSED), live: false })).toBe("");
  });
});

describe("stillMissing", () => {
  it("keeps what was aimed at and is still missing when the scroll lands", () => {
    expect(stillMissing({ amount: true, title: true }, { amount: true, title: true }))
      .toEqual({ amount: true, title: true });
  });

  it("drops a field fixed while the form was scrolling to it", () => {
    expect(stillMissing({ amount: true, title: true }, { amount: false, title: true }))
      .toEqual({ amount: false, title: true });
  });

  it("never blooms a field the refusal was not aimed at, however missing", () => {
    expect(stillMissing<"amount" | "title">({ amount: true }, { amount: true, title: true }))
      .toEqual({ amount: true });
    expect(stillMissing({ amount: false, title: true }, { amount: true, title: true }))
      .toEqual({ amount: false, title: true });
  });

  it("aims at nothing when everything was fixed on the way", () => {
    const left = stillMissing({ amount: true, rate: true }, {});
    expect(Object.values(left).some(Boolean)).toBe(false);
  });
});

describe("staleFlashes", () => {
  type F = "amount" | "receipt" | "rate";
  const live: Refusal = { n: 1, live: true };

  it("is empty while every running flash still has something to point at", () => {
    expect(staleFlashes<F>({ amount: live, receipt: NOT_REFUSED, rate: NOT_REFUSED }, { amount: true }))
      .toEqual([]);
  });

  it("names a running flash whose field was fixed — its element may be gone", () => {
    expect(staleFlashes<F>({ amount: live, receipt: live, rate: live }, { amount: true }))
      .toEqual(["receipt", "rate"]);
  });

  it("ignores flashes that already ended, missing or not", () => {
    const ended = { n: 3, live: false };
    expect(staleFlashes<F>({ amount: ended, receipt: ended, rate: NOT_REFUSED }, {})).toEqual([]);
  });
});
