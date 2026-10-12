// Doc: docs/sync.md#the-push-has-a-ceiling
import type { SealedOp } from "@bida/core";

export const MAX_PUSH_BYTES = 16_000_000;

export const MAX_OPS_PER_PUSH = 5_000;

/**
 * The largest honest op is an expense with a scanned bill; 120 lines split twelve
 * ways is ~30 KiB.
 */
export const MAX_SEALED_BYTES = 256_000;

interface PushRefusal {
  error: string;
  status: 413;
}

/**
 * A missing header is allowed (unlike the scan): this route buffers, so
 * `pushTooLarge` bounds it anyway.
 */
export function declaredTooLarge(header: string | null, max = MAX_PUSH_BYTES): PushRefusal | null {
  const declared = Number(header ?? NaN);
  if (!Number.isFinite(declared) || declared <= max) return null;
  return { error: "push too large", status: 413 };
}

export function pushTooLarge(ops: readonly SealedOp[]): PushRefusal | null {
  if (ops.length > MAX_OPS_PER_PUSH) {
    return { error: `a push carries at most ${MAX_OPS_PER_PUSH} ops`, status: 413 };
  }
  let total = 0;
  for (const op of ops) {
    if (op.sealed.length > MAX_SEALED_BYTES) {
      return { error: `a sealed op is at most ${MAX_SEALED_BYTES} bytes`, status: 413 };
    }
    total += op.sealed.length;
    if (total > MAX_PUSH_BYTES) return { error: "push too large", status: 413 };
  }
  return null;
}

/** The free plan allows 50 external subrequests per invocation. */
export const MAX_NOTIFY_PER_BATCH = 40;

export const MAX_NOTIFY_BYTES = 4096;

export const MAX_ENDPOINT_CHARS = 2048;

export const MAX_NOTIFY_BODY_BYTES = 512_000;
