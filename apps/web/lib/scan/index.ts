import type { ScanResult } from "@hajsik/core";
import { downscaleToBase64Jpeg } from "./downscale";
import { buildScanRequestBody } from "./request";
import { parseScanResponse } from "./response";

export { normalizeScan } from "@hajsik/core";
export type { ScanResult, ScanPatch } from "@hajsik/core";

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
  if (!res.ok) {
    throw new Error(`scan failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return parseScanResponse(await res.json());
}
