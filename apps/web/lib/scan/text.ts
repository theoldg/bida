import { BILL_TEXT_MAX, type Bill } from "@bida/core";
import { copy } from "../copy";

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

/**
 * A photographed bill, written out the way somebody would type it, so "Type it
 * in" opens on the reading rather than an empty box: fixing one misread line is
 * then an edit and a re-read, not a retake. **In English** — the translated
 * labels, since this is for the person to correct, not a transcript of the till.
 *
 * One line per `readBill` item, in the shape the typed prompt reads as a line
 * total ("3 chicken 39"), so the grid's unfolded portions don't come back as
 * lines of their own. The total only where the bill printed one: a typed
 * reading adds the lines up itself, and a made-up total checks nothing.
 */
export function billAsText(bill: Bill, total: string | null): string {
  const w = copy.scan.typeIn.written;
  const lines = bill.items.map((item) => [
    item.quantity !== null && item.quantity !== 1 ? String(item.quantity) : "",
    item.labelEn || item.label,
    item.amount,
  ].filter(Boolean).join(" "));
  if (bill.extras.tip) lines.push(`${w.tip} ${bill.extras.tip}`);
  if (bill.extras.tax) lines.push(`${w.tax} ${bill.extras.tax}`);
  for (const off of bill.extras.discounts) {
    lines.push(`${off.labelEn || off.label || w.discount} -${off.amount}`);
  }
  if (total) lines.push(`${w.total} ${total}`);
  // No real till roll comes near the cap, but the box would clip one that did.
  return lines.join("\n").slice(0, BILL_TEXT_MAX);
}
