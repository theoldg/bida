import { BILL_TEXT_MAX } from "@bida/core";

/**
 * A typed bill, on its way into the same envelope a photo rides in: the
 * dialog's cap, and base64 of UTF-8 (`btoa` refuses anything above U+00FF).
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
 * Base64 of this text's UTF-8 bytes. Chunked: spreading all bytes into
 * `String.fromCharCode` overflows the stack in the tens of thousands — above
 * `BILL_TEXT_MAX` today, but the cap may be raised.
 */
export function billTextToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let ascii = "";
  for (let i = 0; i < bytes.length; i += 0x2000) {
    ascii += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  }
  return btoa(ascii);
}
