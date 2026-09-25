import {
  AI_STUDIO_URL, buildScanRequestBody, checkScan,
  scanCurrency, type ScanLimitScope, type ScanMedium, type ScanProblem, type ScanResult,
} from "@bida/core";
import { groupToken } from "../seal";
import { noteScan, overCallerBudget } from "./budget";
import { downscaleToBase64Jpeg } from "./downscale";
import { ownKey } from "./key";
import { parseScanResponse } from "./response";
import { stasMode } from "./stas";
import { billTextToBase64 } from "./text";
import { TurnstileBlockedError, turnstileToken } from "./turnstile";

export { TurnstileBlockedError } from "./turnstile";

/** The model read the photo fine but declined it — not a receipt, too blurry, etc. Message is model-written, shown verbatim. */
export class ScanRejectedError extends Error {}

/** Gemini's free tier is rate-limited or overloaded (429/503) — distinct from a genuine read failure so the person knows to just wait. */
export class ScanUnavailableError extends Error {}

/**
 * The model answered, but the bill doesn't reconcile — see `checkScan`.
 * Carries which of the four, so the app can say the one true thing.
 */
export class ScanUnreliableError extends Error {
  constructor(readonly problem: ScanProblem) {
    super(problem);
  }
}

/**
 * The phone can't reach anything. Scanning is the one act that needs a
 * network, so "couldn't read that receipt" would be a lie about the photo.
 */
export class ScanOfflineError extends Error {}

/**
 * Our scan budget is spent — not Gemini's, and unlike `ScanUnavailableError`
 * waiting a minute won't fix it. Carries the bucket: your own ten an hour and
 * a shared daily cap are different sentences.
 * See docs/receipt-scanning.md#what-the-scan-costs.
 */
export class ScanLimitError extends Error {
  constructor(readonly scope: ScanLimitScope) {
    super(scope);
  }
}

/**
 * The phone's own key is unusable — impossible on the shared path. `refused`
 * is Google rejecting the key; `spent` is it out of quota, theirs to wait out.
 * Both point at `/advanced`.
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
 * retry doubles our requests and the shared Gemini quota; the person decides.
 * See docs/receipt-scanning.md.
 *
 * **Two ways out of the phone.** With a key of their own (`/advanced`) the
 * phone calls Google directly; the paths meet again at the answer, read and
 * checked identically. The bearer, Turnstile token and budgets belong to the
 * shared path alone.
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
  return readBill(() => downscaleToBase64Jpeg(photo), "photo", groupId, secret, currency);
}

/**
 * The same reading, of a typed bill. Everything but the bytes is shared with
 * `scanReceipt` — envelope, bearer, Turnstile, budgets, `checkScan` — since it
 * asks the same model the same question
 * (docs/receipt-scanning.md#typing-a-bill-in). The text arrives capped and
 * cleaned (`./text.ts`).
 */
export async function parseBillText(
  text: string,
  groupId: string,
  secret: string,
  currency: string,
): Promise<ScanResult> {
  return readBill(() => Promise.resolve(billTextToBase64(text)), "text", groupId, secret, currency);
}

/**
 * One door for every bill: parse, honour the model's own refusal, then hold
 * the answer to `checkScan`. Everything downstream may assume it adds up.
 */
async function readBill(
  /** The bill as base64, run inside the round trip so a slow resize hides
   *  behind the challenge rather than following it (Gotchas). */
  encode: () => Promise<string>,
  medium: ScanMedium,
  groupId: string,
  secret: string,
  currency: string,
): Promise<ScanResult> {
  // Asked before the encode, which for a photo is the expensive part: there is
  // no point resizing one we cannot send. True of both paths — neither has
  // anything to say to a phone with no network.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new ScanOfflineError("offline");
  }

  const own = await ownKey();
  const answer = own
    ? await readOnOwnKey(encode, medium, own)
    : await readOnSharedKey(encode, medium, groupId, secret);

  const result = parseScanResponse(answer);
  if (result.error) throw new ScanRejectedError(result.error);
  // The medium goes with it: a photograph with no total is a cropped
  // photograph, and a typed bill with no total is Tuesday (`checkScan`).
  const problem = checkScan(result, scanCurrency(result, currency), medium);
  if (problem) throw new ScanUnreliableError(problem);
  return result;
}

/**
 * The scan on the phone's own key: phone → Google. Core's envelope, the same
 * the Worker streams (`buildScanRequestBody`), so only the payer differs.
 * Nothing here passes through us, which is the feature — and why there is no
 * fallback through the Worker on failure.
 */
async function readOnOwnKey(
  encode: () => Promise<string>,
  medium: ScanMedium,
  key: string,
): Promise<unknown> {
  const billBase64 = await encode();
  let res: Response;
  try {
    res = await fetch(AI_STUDIO_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      // Staś mode and the medium both still pick between envelopes core holds —
      // here they are simply arguments, with no headers and no Worker between.
      body: JSON.stringify(
        buildScanRequestBody(billBase64, stasMode() ? "stas" : "kind", medium),
      ),
    });
  } catch (err) {
    // fetch rejects only when no server answered. A browser extension blocking
    // googleapis.com lands here too, which is why `/advanced` tests the key once
    // when it is pasted (./key.ts).
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
 * The scan on the deployment's key, through our Worker, which owns the
 * envelope, counts the cost and refuses an unverified browser.
 */
async function readOnSharedKey(
  encode: () => Promise<string>,
  medium: ScanMedium,
  groupId: string,
  secret: string,
): Promise<unknown> {
  // Asked before the downscale, for the same reason as the offline check: this
  // phone already knows the answer, so there is nothing to resize and nothing
  // to send. The Worker asks again — this copy is advice (./budget.ts).
  if (await overCallerBudget(groupId)) throw new ScanLimitError("caller");

  // Together, not in sequence: encoding is CPU, the challenge is a round trip.
  // `turnstileToken` usually has a warmed token (`warmTurnstile`).
  const [billBase64, token, turnstile] = await Promise.all([
    encode(),
    groupToken(groupId, secret),
    // One token is spent per scan and never reused. A blocked script is a
    // refusal, not a fallback — see ./turnstile.ts.
    turnstileToken(),
  ]);
  await noteScan(groupId);
  let res: Response;
  try {
    // The body is the bill and nothing else: the prompt and the response
    // schema are the Worker's, which is what stops our Gemini key from being
    // an open one — docs/receipt-scanning.md#the-envelope-and-who-owns-it.
    res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Authorization: `Bearer ${token}`,
        ...(turnstile ? { "X-Turnstile-Token": turnstile } : {}),
        // One bit, and it picks between two prompts the Worker holds — never
        // a word of one. The envelope stays the Worker's (./stas.ts).
        ...(stasMode() ? { "X-Stas": "1" } : {}),
        // Which of the four envelopes the Worker holds. Absent is a photo, so
        // every request already written means what it always did.
        ...(medium === "text" ? { "X-Input": "text" } : {}),
      },
      body: billBase64,
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
