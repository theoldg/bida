import { describe, expect, it } from "vitest";
import type { SealedOp } from "@bida/core";
import {
  MAX_ENDPOINT_CHARS, MAX_NOTIFY_BODY_BYTES, MAX_NOTIFY_BYTES, MAX_NOTIFY_PER_BATCH,
  MAX_OPS_PER_PUSH, MAX_PUSH_BYTES, MAX_SEALED_BYTES,
  declaredTooLarge, pushTooLarge,
} from "./push-limits";

/** The push ceilings (push-limits.ts), checked at both ends of every cap. */

function op(sealedBytes: number, i = 0): SealedOp {
  return { id: `op-${i}`, groupId: "g1", sealed: "A".repeat(sealedBytes), seq: null };
}

/** A generous honest op: an expense carrying a 120-line scanned bill. */
const HONEST_RECEIPT_BYTES = 30_000;

describe("declaredTooLarge", () => {
  it("passes a body at the cap and refuses one over it", () => {
    expect(declaredTooLarge(String(MAX_PUSH_BYTES))).toBeNull();
    expect(declaredTooLarge(String(MAX_PUSH_BYTES + 1))).toEqual({
      error: "push too large", status: 413,
    });
  });

  it("takes a tighter cap for the notify route", () => {
    expect(declaredTooLarge(String(MAX_NOTIFY_BODY_BYTES), MAX_NOTIFY_BODY_BYTES)).toBeNull();
    expect(declaredTooLarge(String(MAX_NOTIFY_BODY_BYTES + 1), MAX_NOTIFY_BODY_BYTES)?.status).toBe(413);
  });

  // Unlike the scan: this route buffers, so `pushTooLarge` bounds it anyway.
  it("lets a missing or unparseable header through rather than 411", () => {
    expect(declaredTooLarge(null)).toBeNull();
    expect(declaredTooLarge("chunked")).toBeNull();
  });
});

describe("the notify batch", () => {
  // Base64 grows 4/3, JSON adds quotes and keys; a full batch must fit.
  it("holds a full batch at every cap", () => {
    const perNote = Math.ceil(MAX_NOTIFY_BYTES / 3) * 4 + MAX_ENDPOINT_CHARS + 40;
    expect(MAX_NOTIFY_PER_BATCH * perNote).toBeLessThan(MAX_NOTIFY_BODY_BYTES);
  });
});

describe("pushTooLarge", () => {
  it("passes an empty push and a realistic one", () => {
    expect(pushTooLarge([])).toBeNull();
    expect(pushTooLarge([...Array(50)].map((_, i) => op(HONEST_RECEIPT_BYTES, i)))).toBeNull();
  });

  it("refuses more ops than the count cap, and passes exactly that many", () => {
    const at = [...Array(MAX_OPS_PER_PUSH)].map((_, i) => op(1, i));
    expect(pushTooLarge(at)).toBeNull();
    expect(pushTooLarge([...at, op(1, MAX_OPS_PER_PUSH)])?.status).toBe(413);
  });

  it("refuses one oversized op however few there are", () => {
    expect(pushTooLarge([op(MAX_SEALED_BYTES)])).toBeNull();
    expect(pushTooLarge([op(MAX_SEALED_BYTES + 1)])).toEqual({
      error: `a sealed op is at most ${MAX_SEALED_BYTES} bytes`, status: 413,
    });
  });

  // Many individually legal ops adding up past the byte cap.
  it("refuses a total over the byte cap built from individually legal ops", () => {
    const n = Math.ceil(MAX_PUSH_BYTES / MAX_SEALED_BYTES) + 1;
    expect(n).toBeLessThan(MAX_OPS_PER_PUSH);
    expect(pushTooLarge([...Array(n)].map((_, i) => op(MAX_SEALED_BYTES, i)))).toEqual({
      error: "push too large", status: 413,
    });
  });

  it("sits far enough above honest traffic to be unreachable by one", () => {
    // An honest phone must never hit a cap.
    expect(MAX_SEALED_BYTES).toBeGreaterThan(HONEST_RECEIPT_BYTES * 5);
    expect(MAX_OPS_PER_PUSH).toBeGreaterThan(50 * 50);
  });
});
