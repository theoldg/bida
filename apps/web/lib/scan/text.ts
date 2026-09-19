import { BILL_TEXT_MAX } from "@bida/core";

/**
 * A bill somebody typed, on its way to the same envelope a photograph rides in.
 *
 * Two jobs, both small enough to be worth testing rather than trusting: the cap
 * the dialog is held to, and base64 of UTF-8 — which the browser has no direct
 * call for, `btoa` refusing anything above U+00FF.
 */

/**
 * What is actually sent: trailing blank lines and blank space go, because a
 * paste from a notes app brings plenty and none of it is a bill. Nothing inside
 * is touched — the newlines *are* the bill's lines.
 */
export function cleanBillText(text: string): string {
  return text.replace(/[ \t]+$/gm, "").trim();
}

/** Room left before the cap, so the dialog can say so only when it is close. */
export function billTextLeft(text: string): number {
  return BILL_TEXT_MAX - text.length;
}

/**
 * Base64 of this text's UTF-8 bytes.
 *
 * Chunked, because `String.fromCharCode(...bytes)` on one spread argument list
 * is a stack overflow somewhere in the tens of thousands — well above
 * `BILL_TEXT_MAX`, but the cap is a product decision and this is not the place
 * to inherit a crash from someone raising it.
 */
export function billTextToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let ascii = "";
  for (let i = 0; i < bytes.length; i += 0x2000) {
    ascii += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  }
  return btoa(ascii);
}
