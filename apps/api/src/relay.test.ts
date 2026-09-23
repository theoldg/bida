import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64, toBase64Url, type VapidKeys } from "@bida/core";
import { MAX_NOTIFY_BYTES, MAX_NOTIFY_PER_BATCH } from "./push-limits";
import { parseNotify, pushServiceAllowed, relay, type Notification } from "./relay";

/** The relay (docs/notifications.md, plan step 4): where it forwards, and what it answers. */

const FCM = "https://fcm.googleapis.com/fcm/send/abc:def";
const APPLE = "https://web.push.apple.com/QGx1";
const MOZILLA = "https://updates.push.services.mozilla.com/wpush/v2/gAAA";
const NOW = 1_790_000_000_000;

async function vapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"],
  ) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as JsonWebKey;
  const point = new Uint8Array(65);
  point[0] = 4;
  point.set(fromBase64Url(jwk.x!)!, 1);
  point.set(fromBase64Url(jwk.y!)!, 33);
  return { publicKey: toBase64Url(point), privateKey: jwk.d! };
}

const note = (endpoint: string, bytes = 100): Notification => ({ endpoint, body: new Uint8Array(bytes) });

/** A push service that records what it was sent and answers `status`. */
function service(status: (url: string) => number | "hang" | "throw" = () => 201) {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const s = status(url);
    if (s === "throw") throw new TypeError("network down");
    if (s === "hang") {
      return new Promise<Response>((_, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
      });
    }
    return new Response("prose", { status: s });
  };
  return { calls, send };
}

describe("pushServiceAllowed", () => {
  it("allows the four push services' hosts", () => {
    for (const url of [FCM, APPLE, MOZILLA, "https://wns2-db5p.notify.windows.com/w/?token=x"]) {
      expect(pushServiceAllowed(url)).toBe(true);
    }
  });

  it("refuses anything else, however close it looks", () => {
    for (const url of [
      "http://fcm.googleapis.com/fcm/send/x",
      "https://fcm.googleapis.com:8443/x",
      "https://user@fcm.googleapis.com/x",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evilpush.apple.com/x",
      "https://push.apple.com.example/x",
      "https://bida.bid/api/health",
      "not a url",
    ]) {
      expect(pushServiceAllowed(url), url).toBe(false);
    }
  });
});

describe("parseNotify", () => {
  const body = toBase64(new Uint8Array(200));

  it("reads an empty batch as none, and decodes each body", () => {
    expect(parseNotify([])).toEqual([]);
    const [n] = parseNotify([{ endpoint: FCM, body }]) as Notification[];
    expect(n!.endpoint).toBe(FCM);
    expect(n!.body.length).toBe(200);
  });

  // A phone may hold a subscription from a service we don't know; refusing would lose the batch every time.
  it("keeps an unknown host rather than refusing the batch", () => {
    expect(parseNotify([{ endpoint: "https://push.example/x", body }])).toHaveLength(1);
  });

  it("refuses a missing or malformed batch with 400", () => {
    for (const raw of [undefined, {}, [null], [{ endpoint: 1, body }], [{ endpoint: FCM }], [{ endpoint: FCM, body: "!!" }], [{ endpoint: FCM, body: "" }]]) {
      expect((parseNotify(raw) as { status: number }).status, JSON.stringify(raw)).toBe(400);
    }
  });

  it("passes the caps exactly and refuses one over with 413", () => {
    const at = [...Array(MAX_NOTIFY_PER_BATCH)].map(() => ({ endpoint: FCM, body }));
    expect(parseNotify(at)).toHaveLength(MAX_NOTIFY_PER_BATCH);
    expect((parseNotify([...at, at[0]]) as { status: number }).status).toBe(413);

    const full = toBase64(new Uint8Array(MAX_NOTIFY_BYTES));
    expect(parseNotify([{ endpoint: FCM, body: full }])).toHaveLength(1);
    const over = toBase64(new Uint8Array(MAX_NOTIFY_BYTES + 1));
    expect((parseNotify([{ endpoint: FCM, body: over }]) as { status: number }).status).toBe(413);
  });

  it("sits above the largest honest message and under the free plan's 50 subrequests", () => {
    // One aes128gcm record is the most `encryptPush` ever writes.
    expect(MAX_NOTIFY_BYTES).toBe(4096);
    expect(MAX_NOTIFY_PER_BATCH).toBeLessThan(50);
  });
});

describe("relay", () => {
  it("forwards each notification signed, encrypted-as-is, and answers each status", async () => {
    const keys = await vapidKeys();
    const { calls, send } = service((url) => (url === APPLE ? 410 : 201));
    const statuses = await relay([note(FCM, 300), note(APPLE)], keys, "https://bida.bid", NOW, send);
    expect(statuses).toEqual({ [FCM]: 201, [APPLE]: 410 });

    const fcm = calls.find((c) => c.url === FCM)!;
    const headers = fcm.init.headers as Record<string, string>;
    expect(fcm.init.method).toBe("POST");
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(Number(headers["ttl"])).toBeGreaterThan(0);
    expect(headers["authorization"]).toMatch(new RegExp(`^vapid t=.+, k=${keys.publicKey}$`));
    expect((fcm.init.body as Uint8Array).length).toBe(300);
  });

  it("signs once per push service, not once per message", async () => {
    const keys = await vapidKeys();
    const { calls, send } = service();
    await relay([note(`${FCM}1`), note(`${FCM}2`), note(APPLE)], keys, "https://bida.bid", NOW, send);
    const auth = (url: string) =>
      (calls.find((c) => c.url === url)!.init.headers as Record<string, string>)["authorization"];
    expect(auth(`${FCM}1`)).toBe(auth(`${FCM}2`));
    expect(auth(APPLE)).not.toBe(auth(`${FCM}1`));
  });

  it("answers 0 without a fetch for a host off the list, or with no VAPID key", async () => {
    const keys = await vapidKeys();
    const { calls, send } = service();
    expect(await relay([note("https://bida.bid/x")], keys, "https://bida.bid", NOW, send))
      .toEqual({ "https://bida.bid/x": 0 });
    expect(await relay([note(FCM)], null, "https://bida.bid", NOW, send)).toEqual({ [FCM]: 0 });
    expect(calls).toHaveLength(0);
  });

  it("answers 0 for a network error or a service that never answers, and still the rest", async () => {
    const keys = await vapidKeys();
    const { send } = service((url) => (url === APPLE ? "hang" : url === MOZILLA ? "throw" : 201));
    const statuses = await relay([note(FCM), note(APPLE), note(MOZILLA)], keys, "https://bida.bid", NOW, send);
    expect(statuses).toEqual({ [FCM]: 201, [APPLE]: 0, [MOZILLA]: 0 });
  });

  it("answers 0 rather than throwing when the VAPID key is malformed", async () => {
    const { calls, send } = service();
    const broken = { publicKey: "nope", privateKey: "nope" };
    expect(await relay([note(FCM)], broken, "https://bida.bid", NOW, send)).toEqual({ [FCM]: 0 });
    expect(calls).toHaveLength(0);
  });

  it("sends a repeated endpoint once", async () => {
    const keys = await vapidKeys();
    const { calls, send } = service();
    expect(await relay([note(FCM), note(FCM)], keys, "https://bida.bid", NOW, send)).toEqual({ [FCM]: 201 });
    expect(calls).toHaveLength(1);
  });
});
