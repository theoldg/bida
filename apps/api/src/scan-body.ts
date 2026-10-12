// Doc: docs/scan-worker.md
import { MAX_IMAGE_BYTES, buildScanRequestBody, type ScanMedium, type ScanTone } from "@bida/core";

export type { ScanMedium, ScanTone } from "@bida/core";

/**
 * Cut from core's JSON at a sentinel, so there is no second copy of the prompt.
 * Per request: the prompt carries today's date.
 */
const SENTINEL = "__RECEIPT_IMAGE__";

function halves(
  tone: ScanTone, medium: ScanMedium, today: string | undefined,
): { prefix: Uint8Array; suffix: Uint8Array } {
  const [prefix, suffix] =
    JSON.stringify(buildScanRequestBody(SENTINEL, tone, medium, today)).split(SENTINEL);
  const encoder = new TextEncoder();
  return { prefix: encoder.encode(prefix), suffix: encoder.encode(suffix!) };
}

export { MAX_IMAGE_BYTES };

export const MAX_TEXT_BYTES = 16_000;

export const MAX_BYTES: Record<ScanMedium, number> = {
  photo: MAX_IMAGE_BYTES,
  text: MAX_TEXT_BYTES,
};

const BASE64 = (() => {
  const ok = new Uint8Array(256);
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=") {
    ok[ch.charCodeAt(0)] = 1;
  }
  return ok;
})();

export class NotBase64Error extends Error {}

/**
 * The alphabet check is a security boundary: the bytes land inside a JSON string,
 * and a quote could inject its own `contents`. That is why typed bills travel
 * base64 too.
 */
export function wrapPayload(
  bill: ReadableStream<Uint8Array>,
  onRefuse?: (err: NotBase64Error) => void,
  tone: ScanTone = "kind",
  medium: ScanMedium = "photo",
  today?: string,
): ReadableStream<Uint8Array> {
  const { prefix, suffix } = halves(tone, medium, today);
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
