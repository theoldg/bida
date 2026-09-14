import {
  checkScan, scanCurrency, type ScanLimitScope, type ScanProblem, type ScanResult,
} from "@bida/core";
import { groupToken } from "../seal";
import { noteScan, overCallerBudget } from "./budget";
import { downscaleToBase64Jpeg } from "./downscale";
import { parseScanResponse } from "./response";
import { TurnstileBlockedError, turnstileToken } from "./turnstile";

export { TurnstileBlockedError } from "./turnstile";

export { normalizeScan } from "@bida/core";
export type { ScanResult, ScanPatch } from "@bida/core";

/** The model read the photo fine but declined it — not a receipt, too blurry, etc. Message is model-written, shown verbatim. */
export class ScanRejectedError extends Error {}

/** Gemini's free tier is rate-limited or overloaded (429/503) — distinct from a genuine read failure so the person knows to just wait. */
export class ScanUnavailableError extends Error {}

/**
 * The photo was fine and the model answered, but what came back doesn't
 * reconcile — see `checkScan`. Carries which of the four it is, so the app can
 * say the one true thing rather than a shrug that covers all of them.
 */
export class ScanUnreliableError extends Error {
  constructor(readonly problem: ScanProblem) {
    super(problem);
  }
}

/**
 * The phone can't reach anything. Scanning is the one act in the app that
 * needs a network — everything else is local first — so "couldn't read that
 * receipt" was a lie about the photo when the truth was about the signal.
 */
export class ScanOfflineError extends Error {}

/**
 * The budget for this scan is spent — ours, not Gemini's, and a different
 * thing from `ScanUnavailableError` because waiting a minute will not fix it.
 * Carries which bucket it came out of: a person who has scanned ten bills this
 * hour is told something quite different from one who arrived at a shared
 * daily cap somebody else spent. See docs/receipt-scanning.md#what-the-scan-costs.
 */
export class ScanLimitError extends Error {
  constructor(readonly scope: ScanLimitScope) {
    super(scope);
  }
}

/** Which of our own buckets refused this, if it was ours at all. */
async function refusalScope(res: Response): Promise<ScanLimitScope | "turnstile" | null> {
  const body = await res.json().catch(() => null) as { scope?: unknown } | null;
  const scope = body?.scope;
  return scope === "caller" || scope === "client" || scope === "global" || scope === "turnstile"
    ? scope
    : null;
}

/**
 * Photographs → `ScanResult`. One request per scan, no automatic retry — a
 * retry doubles both our requests and the shared daily Gemini quota; the scan
 * buttons stay enabled and the person decides. See docs/receipt-scanning.md.
 */
export async function scanReceipt(
  photo: File | Blob,
  groupId: string,
  /** The group's link secret, or this phone's scan credential. Derived from,
   *  never sent: the bearer is the token beside the key (ADR-0036). */
  secret: string,
  /** The draft's currency — what a receipt that doesn't name its own is counted in. */
  currency: string,
): Promise<ScanResult> {
  // Asked before the downscale, which is the expensive part: there is no point
  // resizing a photo we cannot send.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new ScanOfflineError("offline");
  }
  // Asked before the downscale too, and for the same reason: this phone
  // already knows the answer, so there is nothing to resize and nothing to
  // send. The Worker asks again — this copy is advice (./budget.ts).
  if (await overCallerBudget(groupId)) throw new ScanLimitError("caller");

  const imageBase64 = await downscaleToBase64Jpeg(photo);
  const token = await groupToken(groupId, secret);
  // Single-use and short-lived, so it is fetched per scan and never held. A
  // blocked script is a refusal, not a fallback — see ./turnstile.ts.
  const turnstile = await turnstileToken();
  await noteScan(groupId);
  let res: Response;
  try {
    // The body is the photo and nothing else: the prompt and the response
    // schema are the Worker's, which is what stops our Gemini key from being
    // an open one — docs/receipt-scanning.md#the-worker-owns-the-envelope.
    res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Authorization: `Bearer ${token}`,
        ...(turnstile ? { "X-Turnstile-Token": turnstile } : {}),
      },
      body: imageBase64,
    });
  } catch (err) {
    // fetch only rejects when the request never reached a server — a captive
    // portal or a dead radio that `navigator.onLine` still calls online.
    throw new ScanOfflineError(err instanceof Error ? err.message : "offline");
  }
  // Our own 429 and Gemini's are the same status and mean opposite things —
  // "come back in a minute" versus "this budget is spent". `scope` is what the
  // Worker adds to tell them apart; Google's error body has no such field.
  if (res.status === 429 || res.status === 403) {
    const scope = await refusalScope(res);
    if (scope === "turnstile") throw new TurnstileBlockedError("the worker would not verify this browser");
    if (scope) throw new ScanLimitError(scope);
  }
  if (res.status === 429 || res.status === 503) {
    throw new ScanUnavailableError("busy");
  }
  if (!res.ok) {
    throw new Error(`scan failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const result = parseScanResponse(await res.json());
  if (result.error) throw new ScanRejectedError(result.error);
  // Checked here rather than at the call site so there is one door: everything
  // downstream of this function may assume the bill it holds adds up.
  const problem = checkScan(result, scanCurrency(result, currency));
  if (problem) throw new ScanUnreliableError(problem);
  return result;
}
