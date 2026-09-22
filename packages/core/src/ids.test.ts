import { afterEach, describe, expect, it } from "vitest";
import { newGroupId, newGroupSecret, newId, newNodeId } from "./ids.js";

/** Ids are never checked against anything, so their shape is their only defence. */

const BASE36 = /^[0-9a-z]+$/;

const real = globalThis.crypto;
afterEach(() => { Object.defineProperty(globalThis, "crypto", { value: real, configurable: true }); });

/** Feed `getRandomValues` a scripted sequence, cycling once it runs out. */
function stubCrypto(bytes: readonly number[]): void {
  let i = 0;
  const value = {
    getRandomValues<T extends ArrayBufferView>(array: T): T {
      const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let j = 0; j < view.length; j++) view[j] = bytes[i++ % bytes.length]!;
      return array;
    },
  };
  Object.defineProperty(globalThis, "crypto", { value, configurable: true });
}

describe("newGroupId", () => {
  it("is 12 base36 characters — the whole of it rides in every invite link", () => {
    for (let i = 0; i < 50; i++) {
      const id = newGroupId();
      expect(id).toHaveLength(12);
      expect(id).toMatch(BASE36);
    }
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 2000 }, newGroupId));
    expect(ids.size).toBe(2000);
  });

  it("reaches every character of the alphabet", () => {
    const seen = new Set(Array.from({ length: 500 }, newGroupId).join(""));
    expect(seen.size).toBe(36);
  });
});

describe("base36 minting", () => {
  it("draws again rather than folding a byte that would bias the alphabet", () => {
    // 252..255 would bias `% 36`; dropping them forces a redraw, and the cycling
    // stub repeats its head: "zzzzzzzy" then "zzzz".
    stubCrypto([252, 253, 254, 255, 35, 71, 107, 143, 179, 215, 251, 34]);
    expect(newGroupId()).toBe("zzzzzzzyzzzz");
  });

  it("keeps drawing until it has a full id, however many bytes are rejected", () => {
    stubCrypto([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0]);
    expect(newGroupId()).toBe("000000000000");
  });

  it("refuses to mint without WebCrypto rather than falling back to Math.random", () => {
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    expect(() => newGroupId()).toThrow(/WebCrypto/);
  });
});

describe("the other ids", () => {
  it("mints a 16-character secret and an 8-character node id, both base36", () => {
    expect(newGroupSecret()).toHaveLength(16);
    expect(newGroupSecret()).toMatch(BASE36);
    expect(newNodeId()).toHaveLength(8);
    expect(newNodeId()).toMatch(BASE36);
  });

  it("still mints entity ids as UUIDs — the op log's idempotency key", () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
