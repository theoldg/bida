/**
 * Base64 both ways, hand-rolled, because `btoa` wants a binary string and isn't
 * typed without DOM. The url alphabet (RFC 4648 §5, unpadded) is what Web Push
 * speaks; the standard one is what the sealed log was written in.
 */

const STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encode(bytes: Uint8Array, alphabet: string, pad: boolean): string {
  let out = "";
  const tail = pad ? "=" : "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]!
      + (b === undefined ? tail : alphabet[(n >> 6) & 63]!)
      + (c === undefined ? tail : alphabet[n & 63]!);
  }
  return out;
}

/** Null on a character outside the alphabet, so each caller throws its own error. */
function decode(text: string, alphabet: string): Uint8Array | null {
  const clean = text.replace(/=+$/, "");
  const bytes = new Uint8Array((clean.length * 3) >> 2);
  let bits = 0, acc = 0, out = 0;
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v < 0) return null;
    acc = ((acc << 6) | v) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out++] = (acc >> bits) & 255;
    }
  }
  return bytes.subarray(0, out);
}

export const toBase64 = (bytes: Uint8Array): string => encode(bytes, STD, true);
export const fromBase64 = (text: string): Uint8Array | null => decode(text, STD);
export const toBase64Url = (bytes: Uint8Array): string => encode(bytes, URL, false);
export const fromBase64Url = (text: string): Uint8Array | null => decode(text, URL);
