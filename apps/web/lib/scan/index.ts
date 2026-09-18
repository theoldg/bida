import {
  AI_STUDIO_URL, buildScanRequestBody, checkScan,
  scanCurrency, type ScanLimitScope, type ScanProblem, type ScanResult,
} from "@bida/core";
import { groupToken } from "../seal";
import { noteScan, overCallerBudget } from "./budget";
import { downscaleToBase64Jpeg } from "./downscale";
import { ownKey } from "./key";
import { parseScanResponse } from "./response";
import { stasMode } from "./stas";
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

/**
 * The key this phone brought is not usable — the one refusal the shared path
 * can never produce, since on that path there is no key of the person's to be
 * wrong. `refused` is Google saying no to the key itself; `spent` is the key
 * working and being out of quota, which is theirs to wait out and nothing to
 * do with our budget. Both point at `/advanced`, where the key can be replaced
 * or removed to fall back to the shared one.
 */
export class ScanKeyError extends Error {
  constructor(readonly why: "refused" | "spent") {
    super(why);
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
 *
 * **Two ways out of the phone, and only one of them is ours.** With a key of
 * their own (`/advanced`) the person calls Google directly and this function
 * is the only place that knows it — the two paths meet again at the answer,
 * which is read, checked and returned identically either way. What differs is
 * everything guarding a key that isn't in play: the bearer, the Turnstile
 * token and all three budgets belong to the shared path alone.
 */
export async function scanReceipt(
  photo: File | Blob,
  groupId: string,
  /** The group's link secret, or this phone's scan credential. Derived from,
   *  never sent: the bearer is the token beside the key (ADR-0036). Unused on
   *  a scan that goes straight to Google, which authenticates nothing of ours. */
  secret: string,
  /** The draft's currency — what a receipt that doesn't name its own is counted in. */
  currency: string,
): Promise<ScanResult> {
  // Asked before the downscale, which is the expensive part: there is no point
  // resizing a photo we cannot send. True of both paths — neither has anything
  // to say to a phone with no network.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new ScanOfflineError("offline");
  }

  const own = await ownKey();
  const answer = own
    ? await scanOnOwnKey(photo, own)
    : await scanOnSharedKey(photo, groupId, secret);

  const result = parseScanResponse(answer);
  if (result.error) throw new ScanRejectedError(result.error);
  // Checked here rather than at the call site so there is one door: everything
  // downstream of this function may assume the bill it holds adds up — and
  // whose key paid for it makes no difference to that.
  const problem = checkScan(result, scanCurrency(result, currency));
  if (problem) throw new ScanUnreliableError(problem);
  return result;
}

/**
 * The scan nobody pays us for: phone → Google, with the key this phone holds.
 *
 * The envelope is core's, the same one the Worker streams
 * (`buildScanRequestBody`), so a brought key buys a different payer and not a
 * different reading. Nothing here is authenticated by us, budgeted by us, or
 * visible to us — which is the whole of the feature, and the reason there is
 * no fallback through the Worker when it fails: a key that has gone somewhere
 * else once is a key that went somewhere else.
 */
async function scanOnOwnKey(photo: File | Blob, key: string): Promise<unknown> {
  const imageBase64 = await downscaleToBase64Jpeg(photo);
  let res: Response;
  try {
    res = await fetch(AI_STUDIO_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      // Staś mode still picks between the two refusals core holds — here it is
      // simply an argument, with no header and no Worker in between.
      body: JSON.stringify(buildScanRequestBody(imageBase64, stasMode() ? "stas" : "kind")),
    });
  } catch (err) {
    // Same reading as the shared path: fetch rejects only when the request
    // reached no server. A browser extension refusing googleapis.com lands
    // here too, which is why `/advanced` makes this call once at the moment
    // the key is pasted, where it can be said plainly (./key.ts).
    throw new ScanOfflineError(err instanceof Error ? err.message : "offline");
  }
  // Google's own statuses, and there is no cap of ours mixed in with them to
  // tell apart — the one simplification this path gets for free.
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new ScanKeyError("refused");
  }
  if (res.status === 429) throw new ScanKeyError("spent");
  if (res.status === 503) throw new ScanUnavailableError("busy");
  if (!res.ok) {
    throw new Error(`scan failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

/**
 * The scan on the key the deployment holds: through our Worker, which owns the
 * envelope, counts what it costs and will not send anything for a browser it
 * could not verify.
 */
async function scanOnSharedKey(
  photo: File | Blob,
  groupId: string,
  secret: string,
): Promise<unknown> {
  // Asked before the downscale, for the same reason as the offline check: this
  // phone already knows the answer, so there is nothing to resize and nothing
  // to send. The Worker asks again — this copy is advice (./budget.ts).
  if (await overCallerBudget(groupId)) throw new ScanLimitError("caller");

  // Started together, not one after the other: resizing the photo is CPU and
  // the challenge is a round trip to Cloudflare, so run in sequence they
  // simply added up. `turnstileToken` usually has a warmed one to hand over
  // (`warmTurnstile`), and where it doesn't the challenge hides behind the
  // resize instead of following it.
  const [imageBase64, token, turnstile] = await Promise.all([
    downscaleToBase64Jpeg(photo),
    groupToken(groupId, secret),
    // One token is spent per scan and never reused. A blocked script is a
    // refusal, not a fallback — see ./turnstile.ts.
    turnstileToken(),
  ]);
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
        // One bit, and it picks between two prompts the Worker holds — never
        // a word of one. The envelope stays the Worker's (./stas.ts).
        ...(stasMode() ? { "X-Stas": "1" } : {}),
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
    if (scope === "turnstile") {
      throw new TurnstileBlockedError("the worker would not verify this browser", "server");
    }
    if (scope) throw new ScanLimitError(scope);
  }
  if (res.status === 429 || res.status === 503) {
    throw new ScanUnavailableError("busy");
  }
  if (!res.ok) {
    throw new Error(`scan failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return res.json();
}
