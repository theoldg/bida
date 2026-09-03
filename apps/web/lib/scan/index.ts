import type { ScanResult } from "@hajsik/core";
import { downscaleToBase64Jpeg } from "./downscale";
import { buildScanRequestBody } from "./request";
import { parseScanResponse } from "./response";

export { normalizeScan } from "@hajsik/core";
export type { ScanResult, ScanPatch } from "@hajsik/core";

/** The model read the photo fine but declined it — not a receipt, too blurry, etc. Message is model-written, shown verbatim. */
export class ScanRejectedError extends Error {}

/** Gemini's free tier is rate-limited or overloaded (429/503) — distinct from a genuine read failure so the person knows to just wait. */
export class ScanUnavailableError extends Error {}

/**
 * The phone can't reach anything. Scanning is the one act in the app that
 * needs a network — everything else is local first — so "couldn't read that
 * receipt" was a lie about the photo when the truth was about the signal.
 */
export class ScanOfflineError extends Error {}

/**
 * Photographs → `ScanResult`. One request per scan, no automatic retry — a
 * retry doubles both our requests and the shared daily Gemini quota; the scan
 * buttons stay enabled and the person decides. See docs/receipt-scanning.md.
 */
export async function scanReceipt(
  photo: File | Blob,
  groupId: string,
  secret: string,
  categoryNames: readonly string[],
): Promise<ScanResult> {
  // Asked before the downscale, which is the expensive part: there is no point
  // resizing a photo we cannot send.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new ScanOfflineError("offline");
  }
  const imageBase64 = await downscaleToBase64Jpeg(photo);
  let res: Response;
  try {
    res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify(buildScanRequestBody(imageBase64, categoryNames)),
    });
  } catch (err) {
    // fetch only rejects when the request never reached a server — a captive
    // portal or a dead radio that `navigator.onLine` still calls online.
    throw new ScanOfflineError(err instanceof Error ? err.message : "offline");
  }
  if (res.status === 429 || res.status === 503) {
    throw new ScanUnavailableError("busy");
  }
  if (!res.ok) {
    throw new Error(`scan failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const result = parseScanResponse(await res.json());
  if (result.error) throw new ScanRejectedError(result.error);
  return result;
}
