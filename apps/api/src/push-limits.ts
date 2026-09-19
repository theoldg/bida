import type { SealedOp } from "@bida/core";

/**
 * Ceilings on one `POST /api/groups/:id/ops` (docs/sync.md#the-push-has-a-ceiling).
 *
 * The push is the only door in the app that registers its own credential:
 * `ensureGroup` takes any unseen id and stores the caller's token hash as the
 * owner, so a bearer token is not a gate against a stranger — only against a
 * stranger touching *someone else's* group. Anyone can mint group ids, and
 * before these caps a single request could carry an unbounded array of
 * unbounded strings into a D1 that gets no further resets.
 *
 * **These bound one request, not a campaign.** What stops a flood of
 * well-formed requests is a counter per caller, which is not built
 * (implementation-status.md). The job here is that no *one* call can spend the
 * day's 100k D1 writes or a visible slice of the 500 MB (hosting.md).
 *
 * Every number is deliberately far above honest traffic, because the failure
 * mode of a tight cap is worse than the flood it prevents: a phone refused a
 * 413 retries the identical body forever, and the server cannot make an old
 * build chunk differently — the same reasoning that keeps the D1 batching in
 * `store.ts` on the server's side of the door. So these are abuse ceilings, not
 * protocol limits, and no honest client should ever be able to find one.
 */

/**
 * Bytes of body. The binding cap in practice, and the only one that can refuse
 * a request before it is read: 5 000 plain ops seal to roughly 6 MB, so a push
 * the count cap allows still fits with room over.
 */
export const MAX_PUSH_BYTES = 16_000_000;

/**
 * Ops in one push. The client sends fifty (`PUSH_CHUNK`, apps/web/lib/db/sync.ts);
 * this is a hundredfold that, which is more than a phone could queue offline in
 * a year of this app's real use.
 */
export const MAX_OPS_PER_PUSH = 5_000;

/**
 * Bytes of one op's ciphertext. The largest honest op by a distance is an
 * expense carrying a scanned bill, because a whole-entity op repeats the item
 * array on every edit (hosting.md); a 120-line bill split twelve ways seals to
 * about 30 KiB, so this is roughly eight times the worst one measured.
 */
export const MAX_SEALED_BYTES = 256_000;

/** A refused push: the body to return and the status to return it with. */
interface PushRefusal {
  error: string;
  status: 413;
}

/**
 * The `content-length` check, asked before the body is read.
 *
 * A missing header is *allowed* through, unlike the scan's, which requires one.
 * The scan streams to Gemini and can never learn the real length; this route
 * buffers, so `tooManyBytes` below bounds it either way, and refusing an absent
 * header would only break whichever proxy or old build doesn't send one for no
 * guarantee gained. The cost of that choice is that an unlabelled body is
 * buffered before it is refused, which the Worker's own 100 MB limit caps.
 */
export function declaredTooLarge(header: string | null): PushRefusal | null {
  const declared = Number(header ?? NaN);
  if (!Number.isFinite(declared) || declared <= MAX_PUSH_BYTES) return null;
  return { error: "push too large", status: 413 };
}

/**
 * The caps that hold whether or not the header was honest: how many ops, how
 * big each one's ciphertext is, and what they add up to.
 *
 * `sealed` is base64, so its `.length` is its byte count.
 */
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
