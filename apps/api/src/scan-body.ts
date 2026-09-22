/**
 * The Worker's half of the scan request: the bill streamed into core's
 * envelope (core/scan-body.ts) without the Worker holding it, refusing
 * anything that isn't base64.
 */
import { buildScanRequestBody, type ScanMedium, type ScanTone } from "@bida/core";

export type { ScanMedium, ScanTone } from "@bida/core";

/**
 * The envelope split around where the bill goes, one pair per tone and medium.
 * Built by cutting core's JSON at a sentinel, so there is no second copy of the
 * prompt. Once per isolate.
 */
const SENTINEL = "__RECEIPT_IMAGE__";

function halves(tone: ScanTone, medium: ScanMedium): { prefix: Uint8Array; suffix: Uint8Array } {
  const [prefix, suffix] =
    JSON.stringify(buildScanRequestBody(SENTINEL, tone, medium)).split(SENTINEL);
  const encoder = new TextEncoder();
  return { prefix: encoder.encode(prefix), suffix: encoder.encode(suffix!) };
}

const ENVELOPE: Record<ScanTone, Record<ScanMedium, { prefix: Uint8Array; suffix: Uint8Array }>> = {
  kind: { photo: halves("kind", "photo"), text: halves("kind", "text") },
  stas: { photo: halves("stas", "photo"), text: halves("stas", "text") },
};

/**
 * The largest base64 body we wrap. A downscaled photo is ~200 KB JPEG, ~270 KB
 * base64 (`lib/scan/downscale.ts`); this leaves room and refuses a 50 MB
 * "photo". Text is capped at 4,000 characters on the phone (`BILL_TEXT_MAX`);
 * its ceiling here is an abuse limit that must still fit a three-byte script.
 */
export const MAX_IMAGE_BYTES = 400_000;

export const MAX_TEXT_BYTES = 16_000;

export const MAX_BYTES: Record<ScanMedium, number> = {
  photo: MAX_IMAGE_BYTES,
  text: MAX_TEXT_BYTES,
};

/** The base64 alphabet, as a byte lookup — see `wrapPayload` for why. */
const BASE64 = (() => {
  const ok = new Uint8Array(256);
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=") {
    ok[ch.charCodeAt(0)] = 1;
  }
  return ok;
})();

/** The body was not base64 — `wrapPayload` refuses to send it anywhere. */
export class NotBase64Error extends Error {}

/**
 * Our envelope with the caller's bill (base64 JPEG or base64 text), streamed
 * between the halves so the Worker never parses a body (docs/hosting.md).
 *
 * The per-chunk alphabet check is a security boundary: the bytes land inside a
 * JSON string, so a quote or backslash could close it and inject its own
 * `contents`. Base64 has neither, so rejecting anything outside it closes the
 * hole at one lookup per byte. **That is why typed bills travel base64 too** —
 * escaping text while streaming would be a second, subtler guard; the medium
 * rides in our own `mimeType`.
 */
export function wrapPayload(
  bill: ReadableStream<Uint8Array>,
  /** Called before the stream errors, since `fetch` surfaces the refusal wrapped. */
  onRefuse?: (err: NotBase64Error) => void,
  /** One of four pre-encoded envelopes — all a caller can say about the prompt. */
  tone: ScanTone = "kind",
  medium: ScanMedium = "photo",
): ReadableStream<Uint8Array> {
  const { prefix, suffix } = ENVELOPE[tone][medium];
  const cap = MAX_BYTES[medium];
  const reader = bill.getReader();
  const refuse = (why: string): never => {
    const err = new NotBase64Error(why);
    onRefuse?.(err);
    throw err;
  };
  let sent = 0;
  let opened = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!opened) {
        opened = true;
        controller.enqueue(prefix);
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        controller.enqueue(suffix);
        controller.close();
        return;
      }
      sent += value.length;
      if (sent > cap) refuse(medium === "text" ? "bill text too large" : "image too large");
      for (const byte of value) {
        if (!BASE64[byte]) refuse("body is not base64");
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      void reader.cancel(reason);
    },
  });
}
