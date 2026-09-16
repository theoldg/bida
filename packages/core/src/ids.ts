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

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** The largest multiple of 36 a byte can hold: 7 × 36. See `randomBase36`. */
const BASE36_LIMIT = 252;

/**
 * `length` characters of base36, each worth its full log2(36) ≈ 5.17 bits.
 *
 * Lowercase letters and digits only, so the result is safe in a URL fragment,
 * a path and a query string alike, and survives being read down a phone line.
 * Bytes at or above `BASE36_LIMIT` are drawn again rather than folded with
 * `%`, which would have made the first four characters of the alphabet likelier
 * than the rest — a small bias, but the entropy figures below are quoted at
 * people and should be true.
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
 * A group's id: 12 base36 characters, ~62 bits.
 *
 * Every link the app hands out carries it — `/join#<groupId>.<secret>`, and
 * `/install` carries one per group this phone holds — so its length is
 * something people see and paste. A UUID spent 36 characters on what 12 do.
 *
 * It is minted on the phone, offline, with nobody to ask whether it is taken,
 * so the length is a birthday bet: a million groups collide with probability
 * ~1 in 10 million. A collision is not a leak — the loser cannot read the
 * winner's group, because reading takes the secret — it costs the second group
 * its sync, since the server keys a row by this id and refuses a push carrying
 * a different token. 62 bits also keeps the id unguessable, which matters
 * because `POST /ops` registers any unseen id (ADR-0003).
 */
export function newGroupId(): string {
  return randomBase36(12);
}

/**
 * The group's shared secret. 16 characters of base36, URL-fragment safe —
 * ~83 bits, not the 128 a 16-byte key would carry: a base36 character holds
 * log2(36) ≈ 5.17 bits. Whoever holds this holds the group — see ADR-0003.
 */
export function newGroupSecret(): string {
  return randomBase36(16);
}

