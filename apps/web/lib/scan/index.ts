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
 * Photographs → `ScanResult`. One request per scan, no automatic retry — a
 * retry doubles both our requests and the shared daily Gemini quota; let the
 * caller offer a "try again" button instead. See docs/receipt-scanning.md.
 */
export async function scanReceipt(
  photo: File | Blob,
  groupId: string,
  secret: string,
  categoryNames: readonly string[],
): Promise<ScanResult> {
  const imageBase64 = await downscaleToBase64Jpeg(photo);
  const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(buildScanRequestBody(imageBase64, categoryNames)),
  });
  if (res.status === 429 || res.status === 503) {
    throw new ScanUnavailableError("Gemini's busy right now — try again in a minute.");
  }
  if (!res.ok) {
    throw new Error(`scan failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const result = parseScanResponse(await res.json());
  if (result.error) throw new ScanRejectedError(result.error);
  return result;
}
