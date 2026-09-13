import { validateOp, type Op } from "./ops.js";
import type { Id } from "./types.js";

/**
 * End-to-end encryption of the op log (ADR-0036).
 *
 * The link secret never leaves the phone. Two independent values are derived
 * from it, and the server only ever meets the first:
 *
 * - a **token**, sent as the bearer. The server stores `sha256(token)` exactly
 *   as it used to store `sha256(secret)`, so auth is unchanged in shape — but a
 *   database leak now hands out a hash of something that decrypts nothing.
 * - a **content key**, AES-GCM-256, which every op body is sealed under.
 *
 * What the server stores per op is an id, a group id, a sequence number and a
 * ciphertext. Everything that carries meaning — the patch, who the actor was,
 * which entity it touched, the note, the stamp — is inside the seal. It cannot
 * read a group, and neither can anyone who takes the database.
 *
 * The derivation is one HKDF-SHA256 over the secret with two `info` strings, so
 * the token tells you nothing about the key. It is not a password KDF and does
 * not need to be: a secret is ~83 random bits (`newGroupSecret`), not something
 * a person typed. That margin is what buys the single pass — shorten the secret
 * and this choice has to be made again.
 */

/** The slice of WebCrypto we need, so core stays free of DOM lib types. */
type KeyHandle = object;

interface SubtleLike {
  importKey(
    format: "raw", keyData: Uint8Array, algorithm: unknown,
    extractable: boolean, usages: string[],
  ): Promise<KeyHandle>;
  deriveBits(algorithm: unknown, baseKey: KeyHandle, length: number): Promise<ArrayBuffer>;
  encrypt(algorithm: unknown, key: KeyHandle, data: Uint8Array): Promise<ArrayBuffer>;
  decrypt(algorithm: unknown, key: KeyHandle, data: Uint8Array): Promise<ArrayBuffer>;
}

interface CryptoLike {
  subtle: SubtleLike;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

function getCrypto(): CryptoLike {
  const c = (globalThis as { crypto?: Partial<CryptoLike> }).crypto;
  if (!c?.subtle || typeof c.getRandomValues !== "function") {
    throw new Error("WebCrypto is unavailable; refusing to sync in the clear");
  }
  return c as CryptoLike;
}

/** What a device needs to talk to the server about one group, and nothing more. */
export interface GroupCrypto {
  /** Sent as the bearer token. Derived, so the server never sees the secret. */
  token: string;
  /** AES-GCM-256 over op bodies. Never sent anywhere, by anyone. */
  key: KeyHandle;
}

/**
 * An op as it crosses the wire and sits in D1: an envelope the server can route
 * and a body it cannot read.
 *
 * `id` stays in the clear because it is the idempotency key — the server has to
 * compare it to dedupe a retried push — and it is a random UUID, which says
 * nothing about what it carries. `groupId` likewise: it is the address.
 */
export interface SealedOp {
  id: Id;
  groupId: Id;
  /** base64: a version byte, a 12-byte IV, then the AES-GCM ciphertext. */
  sealed: string;
  /** Assigned by the server on accept, like an `Op`'s. */
  seq?: number | null;
}

export class SealError extends Error {}

const VERSION = 1;
const IV_BYTES = 12;
const utf8 = new TextEncoder();

/** The fields that ride inside the seal — every field of an op but the envelope. */
type OpBody = Omit<Op, "id" | "groupId" | "seq">;

async function hkdf(secret: string, groupId: string, info: string): Promise<ArrayBuffer> {
  const c = getCrypto();
  const ikm = await c.subtle.importKey("raw", utf8.encode(secret), "HKDF", false, ["deriveBits"]);
  return c.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      // The group id is the salt: two groups that somehow shared a secret still
      // get different keys, and it costs nothing to bind them.
      salt: utf8.encode(`bida/v1/${groupId}`),
      info: utf8.encode(info),
    },
    ikm,
    256,
  );
}

/**
 * The token and the content key for one group's link secret.
 *
 * Deterministic: every device holding the link derives the same pair, which is
 * the whole of how a group agrees on a key with no key exchange.
 */
export async function deriveGroupCrypto(secret: string, groupId: string): Promise<GroupCrypto> {
  const [auth, content] = await Promise.all([
    hkdf(secret, groupId, "auth"),
    hkdf(secret, groupId, "content"),
  ]);
  const key = await getCrypto().subtle.importKey(
    "raw", new Uint8Array(content), { name: "AES-GCM" }, false, ["encrypt", "decrypt"],
  );
  return { token: hex(new Uint8Array(auth)), key };
}

/**
 * Seal an op for the server.
 *
 * The envelope is the additional authenticated data, so a ciphertext cannot be
 * moved to another op id or another group and still open: the server can drop
 * an op or reorder the log, but it cannot forge one or shuffle bodies between
 * them without every phone noticing.
 */
export async function sealOp(crypto: GroupCrypto, op: Op): Promise<SealedOp> {
  const body: OpBody = {
    entity: op.entity,
    entityId: op.entityId,
    kind: op.kind,
    patch: op.patch,
    hlc: op.hlc,
    actor: op.actor,
    note: op.note ?? null,
    createdAt: op.createdAt,
  };
  const iv = getCrypto().getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await getCrypto().subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(op.id, op.groupId) },
    crypto.key,
    utf8.encode(JSON.stringify(body)),
  );
  const packed = new Uint8Array(1 + IV_BYTES + ct.byteLength);
  packed[0] = VERSION;
  packed.set(iv, 1);
  packed.set(new Uint8Array(ct), 1 + IV_BYTES);
  return { id: op.id, groupId: op.groupId, sealed: toBase64(packed), seq: op.seq ?? null };
}

/**
 * Open a sealed op, or throw `SealError`.
 *
 * Throwing is the only honest answer: a body that will not open under this
 * group's key is not an op we may skip past, because skipping it would advance
 * the sync cursor and lose it for good.
 *
 * The envelope is re-validated even though it arrives typed, because where it
 * arrives from is the network.
 */
export async function openOp(crypto: GroupCrypto, input: SealedOp): Promise<Op> {
  const sealed = validateSealedOp(input);
  const packed = fromBase64(sealed.sealed);
  if (packed.length <= 1 + IV_BYTES) throw new SealError("sealed op is too short to be one");
  if (packed[0] !== VERSION) throw new SealError(`unknown seal version: ${packed[0]}`);
  let plain: ArrayBuffer;
  try {
    plain = await getCrypto().subtle.decrypt(
      {
        name: "AES-GCM",
        iv: packed.slice(1, 1 + IV_BYTES),
        additionalData: aad(sealed.id, sealed.groupId),
      },
      crypto.key,
      packed.slice(1 + IV_BYTES),
    );
  } catch {
    throw new SealError("sealed op did not open — wrong key, or it was tampered with");
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new SealError("sealed op opened to something that isn't JSON");
  }
  if (typeof body !== "object" || body === null) throw new SealError("sealed op body isn't an object");
  return validateOp({
    ...(body as Record<string, unknown>),
    id: sealed.id,
    groupId: sealed.groupId,
    seq: sealed.seq ?? null,
  });
}

function aad(id: string, groupId: string): Uint8Array {
  return utf8.encode(`${id}\n${groupId}`);
}

/**
 * Validate an envelope arriving from anywhere untrusted. It checks the routing
 * fields and nothing else — the body's integrity is the seal's job, and a
 * server that could check it would be a server that could read it.
 */
export function validateSealedOp(input: unknown): SealedOp {
  if (typeof input !== "object" || input === null) {
    throw new SealError("sealed op must be an object");
  }
  const o = input as Record<string, unknown>;
  for (const field of ["id", "groupId", "sealed"]) {
    if (typeof o[field] !== "string" || (o[field] as string).length === 0) {
      throw new SealError(`sealed op.${field} must be a non-empty string`);
    }
  }
  const seq = o["seq"];
  if (seq !== undefined && seq !== null && typeof seq !== "number") {
    throw new SealError("sealed op.seq must be a number, null or absent");
  }
  return {
    id: o["id"] as string,
    groupId: o["groupId"] as string,
    sealed: o["sealed"] as string,
    seq: (seq as number | null | undefined) ?? null,
  };
}

// --------------------------------------------------------------- bytes

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Hand-rolled, because `btoa` wants a binary string and isn't typed without DOM. */
function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
      + (b === undefined ? "=" : B64[(n >> 6) & 63]!)
      + (c === undefined ? "=" : B64[n & 63]!);
  }
  return out;
}

function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, "");
  const bytes = new Uint8Array((clean.length * 3) >> 2);
  let bits = 0, acc = 0, out = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new SealError("sealed op isn't base64");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out++] = (acc >> bits) & 255;
    }
  }
  return bytes.subarray(0, out);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
