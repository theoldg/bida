import { fromBase64Url, toBase64Url } from "./bytes.js";
import type { DevicePush } from "./types.js";
import { webCrypto } from "./webcrypto.js";

/**
 * Web Push's two pieces of cryptography, on WebCrypto and nothing else
 * (docs/notifications.md):
 *
 * - **`encryptPush`**, RFC 8291 `aes128gcm`: the sending phone encrypts a
 *   notification to one device's subscription. End to end between two phones —
 *   the relay and the push service see only ciphertext.
 * - **`vapidAuthorization`**, RFC 8292: the Worker signs a short-lived ES256 JWT
 *   so a push service accepts the message as ours.
 */

type KeyHandle = object;

interface SubtleLike {
  importKey(
    format: "raw" | "jwk", keyData: unknown, algorithm: unknown,
    extractable: boolean, usages: string[],
  ): Promise<KeyHandle>;
  exportKey(format: "raw", key: KeyHandle): Promise<ArrayBuffer>;
  generateKey(algorithm: unknown, extractable: boolean, usages: string[]): Promise<unknown>;
  deriveBits(algorithm: unknown, baseKey: KeyHandle, length: number): Promise<ArrayBuffer>;
  encrypt(algorithm: unknown, key: KeyHandle, data: Uint8Array): Promise<ArrayBuffer>;
  sign(algorithm: unknown, key: KeyHandle, data: Uint8Array): Promise<ArrayBuffer>;
}

interface CryptoLike {
  subtle: SubtleLike;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

const getCrypto = () => webCrypto<CryptoLike>("refusing to write a notification");

export class WebPushError extends Error {}

const utf8 = new TextEncoder();
const P256 = { name: "ECDH", namedCurve: "P-256" };
/** One record holds the whole message: we never send more than fits. */
const RECORD_SIZE = 4096;
/** Header (86) + padding delimiter (1) + GCM tag (16) come out of the record. */
export const PUSH_PLAINTEXT_MAX = RECORD_SIZE - 86 - 1 - 16;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function bytesOf(text: string, what: string, length?: number): Uint8Array {
  const bytes = fromBase64Url(text);
  if (!bytes || (length !== undefined && bytes.length !== length)) {
    throw new WebPushError(`${what} isn't ${length ?? "some"} bytes of base64url`);
  }
  return bytes;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const c = getCrypto();
  const key = await c.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await c.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8);
  return new Uint8Array(bits);
}

/** An uncompressed P-256 point, split into the JWK's two coordinates. */
function pointToJwk(point: Uint8Array, d?: Uint8Array): Record<string, unknown> {
  if (point.length !== 65 || point[0] !== 4) {
    throw new WebPushError("a P-256 public key is 65 bytes starting 0x04");
  }
  return {
    kty: "EC", crv: "P-256", ext: true,
    x: toBase64Url(point.subarray(1, 33)),
    y: toBase64Url(point.subarray(33, 65)),
    ...(d ? { d: toBase64Url(d) } : {}),
  };
}

/** The sender's half of one message: a fresh key pair and salt, unless a test pins them. */
export interface PushSenderKeys {
  /** Uncompressed P-256 point, 65 bytes. */
  publicKey: Uint8Array;
  privateKey: KeyHandle;
  salt: Uint8Array;
}

async function freshSenderKeys(): Promise<PushSenderKeys> {
  const c = getCrypto();
  const pair = await c.subtle.generateKey(P256, true, ["deriveBits"]) as {
    publicKey: KeyHandle; privateKey: KeyHandle;
  };
  return {
    publicKey: new Uint8Array(await c.subtle.exportKey("raw", pair.publicKey)),
    privateKey: pair.privateKey,
    salt: c.getRandomValues(new Uint8Array(16)),
  };
}

/** Pin the sender's keys — for RFC 8291's test vectors, never for a real send. */
export async function importSenderKeys(
  publicKey: string, privateKey: string, salt: string,
): Promise<PushSenderKeys> {
  const point = bytesOf(publicKey, "sender public key", 65);
  const d = bytesOf(privateKey, "sender private key", 32);
  return {
    publicKey: point,
    privateKey: await getCrypto().subtle.importKey("jwk", pointToJwk(point, d), P256, false, ["deriveBits"]),
    salt: bytesOf(salt, "salt", 16),
  };
}

/**
 * Encrypt one message to one subscription: RFC 8291 §3.4, a single `aes128gcm`
 * record with no padding. What comes back is the whole request body.
 */
export async function encryptPush(
  to: Pick<DevicePush, "p256dh" | "auth">,
  plaintext: Uint8Array,
  sender?: PushSenderKeys,
): Promise<Uint8Array> {
  if (plaintext.length > PUSH_PLAINTEXT_MAX) {
    throw new WebPushError(`a push carries at most ${PUSH_PLAINTEXT_MAX} bytes`);
  }
  const c = getCrypto();
  const uaPublic = bytesOf(to.p256dh, "p256dh", 65);
  const authSecret = bytesOf(to.auth, "auth", 16);
  const as = sender ?? await freshSenderKeys();

  const uaKey = await c.subtle.importKey("jwk", pointToJwk(uaPublic), P256, false, []);
  const ecdhSecret = new Uint8Array(
    await c.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256),
  );
  const keyInfo = concat(utf8.encode("WebPush: info\0"), uaPublic, as.publicKey);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(as.salt, ikm, utf8.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(as.salt, ikm, utf8.encode("Content-Encoding: nonce\0"), 12);

  const aes = await c.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  // 0x02: this is the last record, and nothing pads it.
  const ciphertext = new Uint8Array(
    await c.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))),
  );

  const header = new Uint8Array(16 + 4 + 1);
  header.set(as.salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = as.publicKey.length;
  return concat(header, as.publicKey, ciphertext);
}

/** A VAPID key pair as the Worker holds it: base64url, the private half a secret. */
export interface VapidKeys {
  /** Uncompressed P-256 point — also what `pushManager.subscribe` is handed. */
  publicKey: string;
  /** The 32-byte scalar. */
  privateKey: string;
}

/** Longest a push service will accept is 24 hours; ours never needs more than one. */
const VAPID_LIFETIME_S = 60 * 60;

/**
 * The `Authorization` header for one push service (RFC 8292 §3): a JWT naming
 * the service's origin, signed with our private key, and our public key beside
 * it. `now` is milliseconds — core takes its clock as an argument.
 */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now: number,
): Promise<string> {
  // The origin, by hand: core's lib has no `URL`. Push services are https only.
  const aud = /^https:\/\/[^/?#@]+/i.exec(endpoint)?.[0];
  if (!aud) throw new WebPushError("a push endpoint is an https URL");
  const c = getCrypto();
  const point = bytesOf(keys.publicKey, "VAPID public key", 65);
  const d = bytesOf(keys.privateKey, "VAPID private key", 32);
  const key = await c.subtle.importKey(
    "jwk", pointToJwk(point, d), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  const json = (value: unknown) => toBase64Url(utf8.encode(JSON.stringify(value)));
  const unsigned = `${json({ typ: "JWT", alg: "ES256" })}.${json({
    aud,
    exp: Math.floor(now / 1000) + VAPID_LIFETIME_S,
    sub: subject,
  })}`;
  // WebCrypto's ECDSA signature is already JWS's r‖s, no DER to unwrap.
  const signature = await c.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8.encode(unsigned));
  return `vapid t=${unsigned}.${toBase64Url(new Uint8Array(signature))}, k=${keys.publicKey}`;
}
