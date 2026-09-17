/**
 * The Worker's half of the scan request: the photo, streamed into the envelope
 * `@bida/core` describes, without the Worker ever holding it.
 *
 * The prompt and the schema are not here — both ends build the same body now
 * (core/scan-body.ts), because a phone scanning on its own key sends one
 * without us. What stays here is the part only a server does: refusing to
 * forward anything that is not base64.
 */
import { buildScanRequestBody, type ScanTone } from "@bida/core";

export type { ScanTone } from "@bida/core";

/**
 * The envelope, split in two around where the photo goes — one pair per tone.
 *
 * Built by calling core's builder with a sentinel and cutting the JSON at it,
 * so the streamed request is the same body a phone sends and there is no
 * second copy of the prompt to drift. Done once per isolate: a scan
 * pays for a stream copy of two short byte arrays and nothing else, and the
 * second tone costs one more pair of them, not a second code path.
 */
const SENTINEL = "__RECEIPT_IMAGE__";

function halves(tone: ScanTone): { prefix: Uint8Array; suffix: Uint8Array } {
  const [prefix, suffix] = JSON.stringify(buildScanRequestBody(SENTINEL, tone)).split(SENTINEL);
  const encoder = new TextEncoder();
  return { prefix: encoder.encode(prefix), suffix: encoder.encode(suffix!) };
}

const ENVELOPE: Record<ScanTone, { prefix: Uint8Array; suffix: Uint8Array }> = {
  kind: halves("kind"),
  stas: halves("stas"),
};

/**
 * The largest base64 body we will wrap. The phone downscales to a ~200 KB
 * JPEG (`lib/scan/downscale.ts`), which is ~270 KB once base64 grows it by a
 * third; this is that with room to spare, and an answer to the caller who
 * would rather send us a 50 MB "photo" to pay Gemini for.
 */
export const MAX_IMAGE_BYTES = 400_000;

/** The base64 alphabet, as a byte lookup — see `wrapImage` for why. */
const BASE64 = (() => {
  const ok = new Uint8Array(256);
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=") {
    ok[ch.charCodeAt(0)] = 1;
  }
  return ok;
})();

/** The body was not a base64 image — `wrapImage` refuses to send it anywhere. */
export class NotAnImageError extends Error {}

/**
 * The request body for one scan: our envelope with the caller's image in it.
 *
 * The image is *streamed* between the two halves rather than read, so the
 * Worker never holds the photo and never parses a body — the 10 ms CPU budget
 * that shaped this endpoint is untouched (docs/hosting.md). The only work per
 * chunk is the alphabet check, which is not politeness about content types:
 * the bytes land inside a JSON string, so a body carrying a quote or a
 * backslash could close that string and write its own `contents` — the arbitrary
 * request this endpoint exists to not forward. Base64 has neither character,
 * so rejecting everything outside its alphabet closes the hole outright and
 * costs one table lookup per byte.
 */
export function wrapImage(
  image: ReadableStream<Uint8Array>,
  /** Told before the stream errors, because a refusal surfaces at `fetch` as
   *  whatever the runtime wraps it in, and the caller deserves the real one. */
  onRefuse?: (err: NotAnImageError) => void,
  /** Which pre-encoded envelope to wrap it in. A caller picks one of two, and
   *  that is the whole of what a caller can say about the prompt. */
  tone: ScanTone = "kind",
): ReadableStream<Uint8Array> {
  const { prefix, suffix } = ENVELOPE[tone];
  const reader = image.getReader();
  const refuse = (why: string): never => {
    const err = new NotAnImageError(why);
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
      if (sent > MAX_IMAGE_BYTES) refuse("image too large");
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
