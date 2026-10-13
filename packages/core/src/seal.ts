// Doc: docs/sync.md#the-protocol
import { fromBase64, toBase64 } from "./bytes.js";
import { validateOp, type Op } from "./ops.js";
import type { Id } from "./types.js";
import { webCrypto } from "./webcrypto.js";

/**
 * End-to-end encryption of the op log (ADR-0036). The link secret never leaves
 * the phone; one HKDF-SHA256 derives two unrelated values:
 *
 * - a **token**, sent as bearer; the server stores `sha256(token)`.
 * - a **content key**, AES-GCM-256, sealing every op body.
 *
 * The server holds only id, group id, seq and ciphertext. HKDF, not a password
 * KDF, because the secret is ~83 random bits (`newGroupSecret`). **Shorten the
 * secret and this choice must be revisited.**
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

const getCrypto = () => webCrypto<CryptoLike>("refusing to sync in the clear");

/** What a device needs to talk to the server about one group, and nothing more. */
export interface GroupCrypto {
  /** Sent as the bearer token. Derived, so the server never sees the secret. */
  token: string;
  /** AES-GCM-256 over op bodies. Never sent anywhere, by anyone. */
  key: KeyHandle;
}

/**
 * An op on the wire and in D1. `id` stays clear as the idempotency key for
 * retried pushes (a random UUID reveals nothing); `groupId` is the address.
 */
export interface SealedOp {
  id: Id;
  groupId: Id;
  /** base64: a version byte, a 12-byte IV, then the AES-GCM ciphertext of the body. */
  sealed: string;
  /** Assigned by the server on accept, like an `Op`'s. */
  seq?: number | null;
}

export class SealError extends Error {}

/** The body as JSON. What a phone without `CompressionStream` still writes. */
const PLAIN = 1;
/** The body as JSON, deflated before sealing: a scanned bill is a third the size. */
const DEFLATED = 2;
const IV_BYTES = 12;
/** Past this a body is a bomb, not an op: the largest honest one is ~30 KiB. */
const MAX_BODY_BYTES = 4_000_000;
const utf8 = new TextEncoder();

interface Codec {
  readable: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } };
  writable: { getWriter(): { write(chunk: Uint8Array): Promise<void>; close(): Promise<void> } };
}

/** Undefined where the platform has no such stream, or no raw deflate. */
function codec(name: "CompressionStream" | "DecompressionStream"): Codec | undefined {
  const Ctor = (globalThis as Record<string, unknown>)[name] as (new (format: string) => Codec) | undefined;
  try {
    return Ctor ? new Ctor("deflate-raw") : undefined;
  } catch {
    return undefined;
  }
}

/** `bytes` through a (de)compression stream, refusing an output past `limit`. */
async function through(stream: Codec, bytes: Uint8Array, limit = Infinity): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const writing = writer.write(bytes).then(() => writer.close());
  writing.catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new SealError("sealed op inflates past any honest op");
    }
    chunks.push(value);
  }
  await writing;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** The fields that ride inside the seal — every field of an op but the envelope. */
type OpBody = Omit<Op, "id" | "groupId" | "seq">;

async function hkdf(secret: string, groupId: string, info: string): Promise<ArrayBuffer> {
  const c = getCrypto();
  const ikm = await c.subtle.importKey("raw", utf8.encode(secret), "HKDF", false, ["deriveBits"]);
  return c.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      // Binds keys to the group, in case two groups ever shared a secret.
      salt: utf8.encode(`bida/v1/${groupId}`),
      info: utf8.encode(info),
    },
    ikm,
    256,
  );
}

/** Deterministic, so every device holding the link agrees on the key without exchange. */
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
 * Seal an op. The envelope is the AAD, so the server can drop or reorder ops
 * but can't forge one or move a body to another id or group.
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
  const json = utf8.encode(JSON.stringify(body));
  const deflate = codec("CompressionStream");
  // Compressed before sealing, because ciphertext doesn't compress: the server
  // stores, and every phone pulls, the smaller one.
  const plain = deflate ? await through(deflate, json) : json;
  const iv = getCrypto().getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await getCrypto().subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(op.id, op.groupId) },
    crypto.key,
    plain,
  );
  const packed = new Uint8Array(1 + IV_BYTES + ct.byteLength);
  packed[0] = deflate ? DEFLATED : PLAIN;
  packed.set(iv, 1);
  packed.set(new Uint8Array(ct), 1 + IV_BYTES);
  return { id: op.id, groupId: op.groupId, sealed: toBase64(packed), seq: op.seq ?? null };
}

/**
 * Open a sealed op, or throw `SealError` (and only that) for anything wrong
 * with the row. The caller skips and records it (`lib/db/sync.ts`), so an op
 * this build can't read — most likely a newer build's entity or kind — costs
 * that op, not the group's sync. The envelope is re-validated: it came off the
 * network.
 */
export async function openOp(crypto: GroupCrypto, input: SealedOp): Promise<Op> {
  const sealed = validateSealedOp(input);
  const packed = fromBase64(sealed.sealed);
  if (!packed) throw new SealError("sealed op isn't base64");
  if (packed.length <= 1 + IV_BYTES) throw new SealError("sealed op is too short to be one");
  const version = packed[0];
  if (version !== PLAIN && version !== DEFLATED) throw new SealError(`unknown seal version: ${version}`);
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
  let json: Uint8Array = new Uint8Array(plain);
  if (version === DEFLATED) {
    const inflate = codec("DecompressionStream");
    if (!inflate) throw new SealError("sealed op is deflated, and this browser cannot inflate");
    try {
      json = await through(inflate, json, MAX_BODY_BYTES);
    } catch (err) {
      if (err instanceof SealError) throw err;
      throw new SealError("sealed op opened to something that doesn't inflate");
    }
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new SealError("sealed op opened to something that isn't JSON");
  }
  if (typeof body !== "object" || body === null) throw new SealError("sealed op body isn't an object");
  try {
    return validateOp({
      ...(body as Record<string, unknown>),
      id: sealed.id,
      groupId: sealed.groupId,
      seq: sealed.seq ?? null,
    });
  } catch (err) {
    throw new SealError(`sealed op opened to one this build cannot read: ${(err as Error).message}`);
  }
}

function aad(id: string, groupId: string): Uint8Array {
  return utf8.encode(`${id}\n${groupId}`);
}

/**
 * Validate an untrusted envelope's routing fields only. The body is the seal's
 * job; a server that could check it could read it.
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

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
