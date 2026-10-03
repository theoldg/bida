import {
  AI_STUDIO_URL, buildScanRequestBody, checkScan, correctOneLine,
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

/** The model declined the photo. Its message is shown verbatim. */
export class ScanRejectedError extends Error {}

/** Gemini is overloaded: the person should just wait. */
export class ScanUnavailableError extends Error {}

/** The bill doesn't reconcile (`checkScan`). */
export class ScanUnreliableError extends Error {
  constructor(readonly problem: ScanProblem) {
    super(problem);
  }
}

/** Or "couldn't read that receipt" would be a lie about the photo. */
export class ScanOfflineError extends Error {}

/** Our budget, not Gemini's: waiting a minute won't fix it. docs/scan-worker.md#what-the-scan-costs. */
export class ScanLimitError extends Error {
  constructor(readonly scope: ScanLimitScope) {
    super(scope);
  }
}

/** The phone's own key: Google rejected it, or it is out of quota. */
export class ScanKeyError extends Error {
  constructor(readonly why: "refused" | "spent") {
    super(why);
  }
}

/** Null when the refusal was Google's, not ours. */
async function refusalScope(res: Response): Promise<ScanLimitScope | "turnstile" | null> {
  const body = await res.json().catch(() => null) as { scope?: unknown } | null;
  const scope = body?.scope;
  return scope === "caller" || scope === "client" || scope === "global" || scope === "turnstile"
    ? scope
    : null;
}

/**
 * No automatic retry: it would double the shared Gemini quota. With a key of
 * its own the phone calls Google directly. docs/receipt-scanning.md.
 */
export async function scanReceipt(
  photo: File | Blob,
  groupId: string,
  /** Derived from, never sent (ADR-0036). */
  secret: string,
  /** For a receipt that doesn't name its own. */
  currency: string,
): Promise<ScanResult> {
  return readBill(() => downscaleToBase64Jpeg(photo), "photo", groupId, secret, currency);
}

/** Everything but the bytes is shared with `scanReceipt`. docs/receipt-scanning.md#typing-a-bill-in. */
export async function parseBillText(
  text: string,
  groupId: string,
  secret: string,
  currency: string,
): Promise<ScanResult> {
  return readBill(() => Promise.resolve(billTextToBase64(text)), "text", groupId, secret, currency);
}

/** Everything downstream may assume the answer adds up. */
async function readBill(
  /** Run inside the round trip, so a slow resize hides behind the challenge. */
  encode: () => Promise<string>,
  medium: ScanMedium,
  groupId: string,
  secret: string,
  currency: string,
): Promise<ScanResult> {
  // Before the expensive resize.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new ScanOfflineError("offline");
  }

  const own = await ownKey();
  const answer = own
    ? await readOnOwnKey(encode, medium, own)
    : await readOnSharedKey(encode, medium, groupId, secret);

  const read = parseScanResponse(answer);
  if (read.error) throw new ScanRejectedError(read.error);
  const billCurrency = scanCurrency(read, currency);
  // A faded digit the unit price and the total both contradict.
  const result = correctOneLine(read, billCurrency);
  // A photograph with no total is cropped; a typed bill with no total is Tuesday.
  const problem = checkScan(result, billCurrency, medium);
  if (problem) throw new ScanUnreliableError(problem);
  return result;
}

/** Nothing passes through us, which is the feature, so there is no fallback through the Worker. */
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
      body: JSON.stringify(
        buildScanRequestBody(billBase64, stasMode() ? "stas" : "kind", medium),
      ),
    });
  } catch (err) {
    // An extension blocking googleapis.com lands here too; `/advanced` tests the key when pasted.
    throw new ScanOfflineError(err instanceof Error ? err.message : "offline");
  }
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

/** The Worker owns the envelope, counts the cost and refuses an unverified browser. */
async function readOnSharedKey(
  encode: () => Promise<string>,
  medium: ScanMedium,
  groupId: string,
  secret: string,
): Promise<unknown> {
  // Advice only; the Worker asks again.
  if (await overCallerBudget(groupId)) throw new ScanLimitError("caller");

  // Together: encoding is CPU, the challenge a round trip.
  const [billBase64, token, turnstile] = await Promise.all([
    encode(),
    groupToken(groupId, secret),
    turnstileToken(),
  ]);
  await noteScan(groupId);
  let res: Response;
  try {
    // The bill and nothing else: a prompt from the phone would make our
    // Gemini key an open one. docs/scan-worker.md#the-envelope-and-who-owns-it.
    res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Authorization: `Bearer ${token}`,
        ...(turnstile ? { "X-Turnstile-Token": turnstile } : {}),
        ...(stasMode() ? { "X-Stas": "1" } : {}),
        // Absent is a photo, so older builds' requests mean what they did.
        ...(medium === "text" ? { "X-Input": "text" } : {}),
      },
      body: billBase64,
    });
  } catch (err) {
    // A captive portal or a dead radio `navigator.onLine` still calls online.
    throw new ScanOfflineError(err instanceof Error ? err.message : "offline");
  }
  // Our 429 means "spent", Gemini's "come back in a minute"; only ours has a `scope`.
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
