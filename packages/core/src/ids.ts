/** Id generation. Client-side, because ops are created offline. */

import { webCrypto } from "./webcrypto.js";

/** The slice of WebCrypto we need, so core stays free of DOM lib types. */
interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID?: () => string;
}

const getCrypto = () =>
  webCrypto<CryptoLike>("refusing to generate weak ids", { subtle: false });

export function newId(): string {
  const c = getCrypto();
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** The largest multiple of 36 a byte can hold: 7 × 36. See `randomBase36`. */
const BASE36_LIMIT = 252;

/**
 * `length` base36 characters (≈5.17 bits each): safe in a fragment, path or
 * query. **Redraw bytes ≥ `BASE36_LIMIT`, never `%`** — modulo biases the
 * output, and the entropy figures below are quoted to people.
 */
function randomBase36(length: number): string {
  const c = getCrypto();
  const out: string[] = [];
  const b = new Uint8Array(length);
  while (out.length < length) {
    c.getRandomValues(b);
    for (const x of b) {
      if (x >= BASE36_LIMIT) continue;
      out.push(ALPHABET[x % 36]!);
      if (out.length === length) break;
    }
  }
  return out.join("");
}

/** Per-device HLC tiebreak id. Stable for the life of the install. */
export function newNodeId(): string {
  return randomBase36(8);
}

/**
 * A group id: 12 base36 characters, ~62 bits, minted offline with nobody to
 * ask. A million groups collide at ~1 in 10 million; a collision costs the
 * second group its sync, not its privacy. Also unguessable, which matters as
 * `POST /ops` registers any unseen id (ADR-0003).
 */
export function newGroupId(): string {
  return randomBase36(12);
}

/** The group's secret: 16 base36 characters, ~83 bits. Whoever holds it holds the group (ADR-0003). */
export function newGroupSecret(): string {
  return randomBase36(16);
}

