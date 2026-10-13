import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveGroupCrypto, openOp, SealError, sealOp, validateSealedOp, type Op,
} from "./index.js";

/**
 * The server must not be able to read a group (ADR-0036): the wire carries an
 * id, a group id and ciphertext, and the bearer token can't be walked back to
 * the key.
 */

const SECRET = "k3n9wq2patl0vzx7bd4rmc8jyf";
const GROUP = "7f2c1a90-1111-4a22-b333-9c0d1e2f3a4b";

function op(over: Partial<Op> = {}): Op {
  return {
    id: "op-1",
    groupId: GROUP,
    entity: "expense",
    entityId: "e-1",
    kind: "create",
    patch: { title: "Dinner at Da Enzo", amountMinor: 8450, currency: "EUR" },
    hlc: "000001756300000-00000-abc123",
    actor: "m-1",
    note: "split three ways",
    createdAt: 1756300000000,
    seq: null,
    ...over,
  };
}

describe("deriveGroupCrypto", () => {
  it("gives every device holding the link the same token", async () => {
    const a = await deriveGroupCrypto(SECRET, GROUP);
    const b = await deriveGroupCrypto(SECRET, GROUP);
    expect(a.token).toBe(b.token);
  });

  it("never hands the secret to the server", async () => {
    const { token } = await deriveGroupCrypto(SECRET, GROUP);
    expect(token).not.toContain(SECRET);
    expect(token).toHaveLength(64);
  });

  it("separates groups, so one link opens exactly one group", async () => {
    const a = await deriveGroupCrypto(SECRET, GROUP);
    const b = await deriveGroupCrypto(SECRET, "some-other-group");
    expect(a.token).not.toBe(b.token);
    await expect(openOp(b, await sealOp(a, op()))).rejects.toThrow(SealError);
  });
});

describe("sealOp / openOp", () => {
  it("round-trips every field of an op", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    const original = op();
    expect(await openOp(crypto, await sealOp(crypto, original))).toEqual(original);
  });

  it("round-trips an op with no note", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    const original = op({ note: null });
    expect(await openOp(crypto, await sealOp(crypto, original))).toEqual(original);
  });

  it("carries the seq the server assigned, not the one it was sealed with", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    const sealed = await sealOp(crypto, op());
    expect(await openOp(crypto, { ...sealed, seq: 412 })).toMatchObject({ seq: 412 });
  });

  /**
   * Probes are 7+ characters, several with a space, so they can't turn up in
   * random base64 by chance — a short one like "EUR" would flake.
   */
  it("puts nothing readable on the wire", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    const sealed = await sealOp(crypto, op());
    const wire = JSON.stringify(sealed);
    for (const probe of [
      "Dinner at Da Enzo", "split three ways", "amountMinor", "currency", "entityId",
    ]) {
      expect(wire).not.toContain(probe);
    }
    expect(Object.keys(sealed).sort()).toEqual(["groupId", "id", "sealed", "seq"]);
  });

  it("is not deterministic — the same op sealed twice looks different", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    const one = await sealOp(crypto, op());
    const two = await sealOp(crypto, op());
    expect(one.sealed).not.toBe(two.sealed);
  });

  it("refuses a different link's key", async () => {
    const mine = await deriveGroupCrypto(SECRET, GROUP);
    const theirs = await deriveGroupCrypto("0000000000000000000000000a", GROUP);
    await expect(openOp(theirs, await sealOp(mine, op()))).rejects.toThrow(SealError);
  });

  it("refuses a body moved onto another op's envelope", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    const sealed = await sealOp(crypto, op());
    await expect(openOp(crypto, { ...sealed, id: "op-2" })).rejects.toThrow(SealError);
  });

  it("refuses a flipped bit", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    const sealed = await sealOp(crypto, op());
    const flipped = sealed.sealed.slice(0, -2)
      + (sealed.sealed.at(-2) === "A" ? "B" : "A") + sealed.sealed.at(-1);
    await expect(openOp(crypto, { ...sealed, sealed: flipped })).rejects.toThrow(SealError);
  });

  it("refuses a seal from a format it doesn't know", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    const sealed = await sealOp(crypto, op());
    // The version byte is the first, so it is the first base64 character's
    // top bits: "AQ..." is version 1, "Ag..." 2, "Aw..." 3.
    const future = "Aw" + sealed.sealed.slice(2);
    await expect(openOp(crypto, { ...sealed, sealed: future })).rejects.toThrow(/version/);
  });

  // The caller skips only SealError, so an unknown-but-openable op must be one,
  // or a newer build's first new entity wedges every older phone.
  it("refuses an op from a newer build as a SealError, so it can be skipped", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    const sealed = await sealOp(crypto, op({ entity: "category" as Op["entity"] }));
    await expect(openOp(crypto, sealed)).rejects.toThrow(SealError);
  });

  it("refuses a stamp no clock could have written as a SealError", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    for (const hlc of ["zzz", "999999999999999-99999-evil", "000001756300000-00000-NOPE"]) {
      await expect(openOp(crypto, await sealOp(crypto, op({ hlc })))).rejects.toThrow(SealError);
    }
  });

  it("refuses something that isn't base64 at all", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    await expect(openOp(crypto, { id: "op-1", groupId: GROUP, sealed: "not base64!!" }))
      .rejects.toThrow(SealError);
  });

  it("survives every byte value in a note", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    const original = op({ note: "🧾 ümlaut\n\ttab — «quoted»   end" });
    expect(await openOp(crypto, await sealOp(crypto, original))).toEqual(original);
  });

  it("survives a body of any length, so base64 padding is right", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    for (let n = 0; n < 20; n++) {
      const original = op({ note: "x".repeat(n) });
      expect(await openOp(crypto, await sealOp(crypto, original))).toEqual(original);
    }
  });
});

describe("validateSealedOp", () => {
  it("accepts a real envelope", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    const sealed = await sealOp(crypto, op());
    expect(validateSealedOp(JSON.parse(JSON.stringify(sealed)))).toEqual(sealed);
  });

  it("refuses envelopes missing what routing needs", () => {
    expect(() => validateSealedOp(null)).toThrow(SealError);
    expect(() => validateSealedOp({ groupId: GROUP, sealed: "AQ" })).toThrow(/id/);
    expect(() => validateSealedOp({ id: "a", sealed: "AQ" })).toThrow(/groupId/);
    expect(() => validateSealedOp({ id: "a", groupId: GROUP })).toThrow(/sealed/);
    expect(() => validateSealedOp({ id: "a", groupId: GROUP, sealed: "AQ", seq: "3" }))
      .toThrow(/seq/);
  });
});

describe("compression", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  /** A scanned bill's worth of repetition, which is what the log spends its bytes on. */
  const bill = () => op({
    patch: {
      title: "Dinner at Da Enzo",
      receiptItems: Array.from({ length: 40 }, (_, i) => ({
        id: `item-${i}`, label: `Spaghetti alle vongole ${i}`, priceMinor: 1450 + i, qty: 1,
      })),
    },
  });

  const version = (sealed: { sealed: string }) => Buffer.from(sealed.sealed, "base64")[0];

  /** A stand-in for `CompressionStream` that hands out `bytes` whatever it is given. */
  function emitting(bytes: Uint8Array) {
    return class {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<Uint8Array>;
      constructor() {
        const t = new TransformStream<Uint8Array, Uint8Array>({
          transform() { /* swallowed */ },
          flush(controller) { controller.enqueue(bytes); },
        });
        this.readable = t.readable;
        this.writable = t.writable;
      }
    };
  }

  it("deflates before sealing, so the wire and the log carry the smaller one", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    const deflated = await sealOp(crypto, bill());
    vi.stubGlobal("CompressionStream", undefined);
    const plain = await sealOp(crypto, bill());
    expect(version(deflated)).toBe(2);
    expect(version(plain)).toBe(1);
    expect(deflated.sealed.length).toBeLessThan(plain.sealed.length / 3);
    vi.unstubAllGlobals();
    expect(await openOp(crypto, deflated)).toEqual(bill());
  });

  it("still opens what a build before compression sealed", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    vi.stubGlobal("CompressionStream", undefined);
    const old = await sealOp(crypto, op());
    vi.unstubAllGlobals();
    expect(await openOp(crypto, old)).toEqual(op());
  });

  it("seals plain where the browser has no raw deflate", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    vi.stubGlobal("CompressionStream", class { constructor() { throw new TypeError("deflate-raw"); } });
    const sealed = await sealOp(crypto, op());
    expect(version(sealed)).toBe(1);
    vi.unstubAllGlobals();
    expect(await openOp(crypto, sealed)).toEqual(op());
  });

  it("is a SealError where the browser cannot inflate, so the op is skipped, not fatal", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    const sealed = await sealOp(crypto, op());
    vi.stubGlobal("DecompressionStream", undefined);
    await expect(openOp(crypto, sealed)).rejects.toThrow(SealError);
  });

  it("is a SealError for a body that does not inflate", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    vi.stubGlobal("CompressionStream", emitting(new TextEncoder().encode("{ not deflate at all")));
    const sealed = await sealOp(crypto, op());
    vi.unstubAllGlobals();
    await expect(openOp(crypto, sealed)).rejects.toThrow(SealError);
  });

  it("refuses a body that inflates past any honest op, rather than holding it", async () => {
    const crypto = await deriveGroupCrypto(SECRET, GROUP);
    vi.stubGlobal("CompressionStream", emitting(new Uint8Array(deflateRawSync(Buffer.alloc(8_000_000)))));
    const bomb = await sealOp(crypto, op());
    vi.unstubAllGlobals();
    expect(bomb.sealed.length).toBeLessThan(20_000);
    await expect(openOp(crypto, bomb)).rejects.toThrow(/inflates past/);
  });
});
