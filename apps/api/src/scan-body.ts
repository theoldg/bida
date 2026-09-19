/**
 * The Worker's half of the scan request: the bill, streamed into the envelope
 * `@bida/core` describes, without the Worker ever holding it.
 *
 * The prompt and the schema are not here — both ends build the same body now
 * (core/scan-body.ts), because a phone scanning on its own key sends one
 * without us. What stays here is the part only a server does: refusing to
 * forward anything that is not base64.
 */
import { buildScanRequestBody, type ScanMedium, type ScanTone } from "@bida/core";

export type { ScanMedium, ScanTone } from "@bida/core";

/**
 * The envelope, split in two around where the bill goes — one pair per tone
 * per medium.
 *
 * Built by calling core's builder with a sentinel and cutting the JSON at it,
 * so the streamed request is the same body a phone sends and there is no
 * second copy of the prompt to drift. Done once per isolate: a scan
 * pays for a stream copy of two short byte arrays and nothing else, and each
 * further tone or medium costs one more pair of them, not a second code path.
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
 * The largest base64 body we will wrap, per medium. The phone downscales a
 * photo to a ~200 KB JPEG (`lib/scan/downscale.ts`), which is ~270 KB once
 * base64 grows it by a third; `MAX_IMAGE_BYTES` is that with room to spare, and
 * an answer to the caller who would rather send us a 50 MB "photo" to pay
 * Gemini for.
 *
 * A typed bill is capped at 4,000 characters on the phone (`BILL_TEXT_MAX`,
 * core/scan.ts), which is ~4 KB of Latin text and ~5.4 KB base64. The ceiling
 * here is well above that on purpose: it has to hold 4,000 characters of a
 * three-byte script too, and like the push caps it is an abuse ceiling rather
 * than a protocol limit. What bounds the ordinary cost is the character count
 * the dialog enforces.
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
 * The request body for one scan: our envelope with the caller's bill in it —
 * a base64 JPEG, or a typed bill base64'd the same way.
 *
 * The bill is *streamed* between the two halves rather than read, so the
 * Worker never holds it and never parses a body — the 10 ms CPU budget
 * that shaped this endpoint is untouched (docs/hosting.md). The only work per
 * chunk is the alphabet check, which is not politeness about content types:
 * the bytes land inside a JSON string, so a body carrying a quote or a
 * backslash could close that string and write its own `contents` — the arbitrary
 * request this endpoint exists to not forward. Base64 has neither character,
 * so rejecting everything outside its alphabet closes the hole outright and
 * costs one table lookup per byte.
 *
 * **That is why a typed bill travels base64 too.** Escaping arbitrary text into
 * a JSON string as it streamed would mean a second, subtler guard on the hot
 * path; base64 reuses the one that is already proved, and the medium rides in
 * the envelope's own `mimeType` instead — which is ours, not the caller's.
 * So what changes with a typed bill is what the model *reads*, never what the
 * request *is*.
 */
export function wrapPayload(
  bill: ReadableStream<Uint8Array>,
  /** Told before the stream errors, because a refusal surfaces at `fetch` as
   *  whatever the runtime wraps it in, and the caller deserves the real one. */
  onRefuse?: (err: NotBase64Error) => void,
  /** Which pre-encoded envelope to wrap it in. A caller picks one of four, and
   *  that is the whole of what a caller can say about the prompt. */
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
