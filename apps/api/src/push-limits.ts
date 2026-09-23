import type { SealedOp } from "@bida/core";

/**
 * Ceilings on one `POST /api/groups/:id/ops` (docs/sync.md#the-push-has-a-ceiling).
 * `ensureGroup` takes any unseen id, so the bearer only guards *someone else's*
 * group; anyone can mint ids and push.
 *
 * **These bound one request, not a campaign** — no per-caller counter exists
 * (implementation-status.md). The goal is that no single call spends the day's
 * 100k D1 writes or a visible slice of 500 MB (hosting.md).
 *
 * Every number is far above honest traffic: a phone refused a 413 retries
 * forever, and the server can't make old builds chunk. No honest client should
 * ever find one.
 */

/** Bytes of body; the only cap checkable before reading. 5,000 ops seal to ~6 MB. */
export const MAX_PUSH_BYTES = 16_000_000;

/** Ops per push: 100× the client's `PUSH_CHUNK` (apps/web/lib/db/sync.ts). */
export const MAX_OPS_PER_PUSH = 5_000;

/**
 * Bytes of one ciphertext. The largest honest op is an expense with a scanned
 * bill (items repeat on every edit); 120 lines split twelve ways is ~30 KiB.
 */
export const MAX_SEALED_BYTES = 256_000;

/** A refused push: the body to return and the status to return it with. */
interface PushRefusal {
  error: string;
  status: 413;
}

/**
 * The `content-length` check, before reading. A missing header is allowed
 * (unlike the scan): this route buffers, so `pushTooLarge` bounds it anyway,
 * and requiring one would break proxies for nothing. An unlabelled body is
 * buffered first, capped by the Worker's 100 MB limit.
 */
export function declaredTooLarge(header: string | null): PushRefusal | null {
  const declared = Number(header ?? NaN);
  if (!Number.isFinite(declared) || declared <= MAX_PUSH_BYTES) return null;
  return { error: "push too large", status: 413 };
}

/** The caps that hold whatever the header said. `sealed` is base64, so `.length` is bytes. */
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

/**
 * Notifications one push may carry (docs/notifications.md). Each is one fetch,
 * and the free plan allows 50 external subrequests per invocation — D1 calls
 * count against Cloudflare's own, separate allowance. The sender writes one per
 * subscribed phone but its own, so a group needs 41 of them to reach this.
 */
export const MAX_NOTIFY_PER_PUSH = 40;

/** One `aes128gcm` message is one 4096-byte record (`core/webpush.ts`). */
export const MAX_NOTIFY_BYTES = 4096;

/** Endpoints run to ~200 characters; this only bounds what gets parsed. */
export const MAX_ENDPOINT_CHARS = 2048;
