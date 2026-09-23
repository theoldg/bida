import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "./bytes.js";
import {
  encryptPush, importSenderKeys, PUSH_PLAINTEXT_MAX, vapidAuthorization, WebPushError,
} from "./webpush.js";

/**
 * RFC 8291 appendix A, byte for byte: if these pass, every push service that
 * implements the RFC can read what a phone sends.
 */
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: RFC.uaPublic, auth: RFC.auth };
const utf8 = new TextEncoder();
const b = (s: string) => fromBase64Url(s)!;

function jwk(publicKey: string, privateKey?: string) {
  const point = b(publicKey);
  return {
    kty: "EC", crv: "P-256",
    x: toBase64Url(point.subarray(1, 33)), y: toBase64Url(point.subarray(33)),
    ...(privateKey ? { d: privateKey } : {}),
  };
}

/** The receiving side of RFC 8291, written out separately so a round trip checks something. */
async function decrypt(body: Uint8Array, uaPublic: string, uaPrivate: string, auth: string) {
  const salt = body.subarray(0, 16);
  const idlen = body[20]!;
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const P256 = { name: "ECDH", namedCurve: "P-256" };
  const priv = await crypto.subtle.importKey("jwk", jwk(uaPublic, uaPrivate), P256, false, ["deriveBits"]);
  const pub = await crypto.subtle.importKey("jwk", jwk(toBase64Url(asPublic)), P256, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256));
  const hk = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) => {
    const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info }, k, n * 8));
  };
  const keyInfo = new Uint8Array([...utf8.encode("WebPush: info\0"), ...b(uaPublic), ...asPublic]);
  const ikm = await hk(b(auth), ecdh, keyInfo, 32);
  const cek = await hk(salt, ikm, utf8.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hk(salt, ikm, utf8.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ct));
  expect(plain.at(-1)).toBe(2);
  return new TextDecoder().decode(plain.subarray(0, -1));
}

describe("encryptPush", () => {
  it("reproduces RFC 8291's example message exactly", async () => {
    const sender = await importSenderKeys(RFC.asPublic, RFC.asPrivate, RFC.salt);
    const body = await encryptPush(sub, utf8.encode(RFC.plaintext), sender);
    expect(toBase64Url(body)).toBe(RFC.body);
  });

  it("opens on the receiving side with fresh keys, and never repeats itself", async () => {
    const one = await encryptPush(sub, utf8.encode("Ana added \"Dinner\""));
    const two = await encryptPush(sub, utf8.encode("Ana added \"Dinner\""));
    expect(toBase64Url(one)).not.toBe(toBase64Url(two));
    expect(await decrypt(one, RFC.uaPublic, RFC.uaPrivate, RFC.auth)).toBe("Ana added \"Dinner\"");
  });

  it("fills one 4096-byte record at most", async () => {
    const full = await encryptPush(sub, new Uint8Array(PUSH_PLAINTEXT_MAX));
    expect(full.length).toBe(4096);
    await expect(encryptPush(sub, new Uint8Array(PUSH_PLAINTEXT_MAX + 1))).rejects.toThrow(WebPushError);
  });

  it("refuses a subscription whose keys are the wrong size", async () => {
    await expect(encryptPush({ ...sub, auth: "AAAA" }, utf8.encode("x"))).rejects.toThrow(WebPushError);
    await expect(encryptPush({ ...sub, p256dh: RFC.auth }, utf8.encode("x"))).rejects.toThrow(WebPushError);
  });
});

describe("vapidAuthorization", () => {
  // RFC 8292's own example key isn't published with its private half; the
  // RFC 8291 sender pair is a valid P-256 pair, which is all this needs.
  const keys = { publicKey: RFC.asPublic, privateKey: RFC.asPrivate };
  const NOW = 1_790_000_000_000;

  it("signs a JWT for the push service's origin that our public key verifies", async () => {
    const header = await vapidAuthorization(
      "https://updates.push.services.mozilla.com/wpush/v2/abc?x=1", keys, "https://bida.bid", NOW,
    );
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m).not.toBeNull();
    expect(m[4]).toBe(keys.publicKey);
    const parse = (s: string) => JSON.parse(new TextDecoder().decode(b(s)));
    expect(parse(m[1]!)).toEqual({ typ: "JWT", alg: "ES256" });
    expect(parse(m[2]!)).toEqual({
      aud: "https://updates.push.services.mozilla.com",
      exp: NOW / 1000 + 3600,
      sub: "https://bida.bid",
    });
    const pub = await crypto.subtle.importKey(
      "jwk", jwk(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, pub, b(m[3]!), utf8.encode(`${m[1]}.${m[2]}`),
    );
    expect(ok).toBe(true);
  });

  it("refuses an endpoint that isn't https", async () => {
    await expect(vapidAuthorization("http://example.com/x", keys, "https://bida.bid", NOW))
      .rejects.toThrow(WebPushError);
  });
});
