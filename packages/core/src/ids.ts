/** Id generation. Client-side, because ops are created offline. */

/** The slice of WebCrypto we need, so core stays free of DOM lib types. */
interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID?: () => string;
}

function getCrypto(): CryptoLike {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error("WebCrypto is unavailable; refusing to generate weak ids");
  }
  return c;
}

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

const NODE_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Per-device HLC tiebreak id. Stable for the life of the install. */
export function newNodeId(): string {
  const c = getCrypto();
  const b = new Uint8Array(8);
  c.getRandomValues(b);
  return [...b].map((x) => NODE_ALPHABET[x % NODE_ALPHABET.length]).join("");
}

/**
 * The group's shared secret. 128 bits, base32-ish, URL-fragment safe.
 * Whoever holds this holds the group — see ADR-0003.
 */
export function newGroupSecret(): string {
  const c = getCrypto();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  return [...b].map((x) => NODE_ALPHABET[x % NODE_ALPHABET.length]).join("");
}

export function newColorSeed(): number {
  const c = getCrypto();
  const b = new Uint32Array(1);
  c.getRandomValues(b);
  return b[0]! % 360;
}
