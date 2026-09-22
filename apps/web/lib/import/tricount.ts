import { ImportError } from "@bida/core";

/**
 * A tricount link, fetched. The JSON that comes back goes to
 * `core/readTricount`, which is where every decision about what it *means*
 * lives — this file is the link, the key pair and one request, and nothing
 * else (docs/frontend.md#bringing-a-group-onto-the-phone).
 *
 * It goes through our Worker because a page cannot read that answer: bunq's
 * reply carries no `Access-Control-Allow-Origin`, so the browser withholds it
 * from whatever asked, however the request was made (checked from bida.bid,
 * 2026-09-22). `apps/api/src/tricount.ts` is the other half, and says why a
 * Worker is allowed what this file is not.
 */

/** Our Worker could not reach tricount, or tricount would not talk to it. */
export class TricountDownError extends Error {}

/** This phone could not reach us. Said differently from tricount being down. */
export class TricountOfflineError extends Error {}

/**
 * The key out of whatever was pasted: a link, a link with tracking on the end,
 * or the key on its own for somebody who has one.
 *
 * The last path segment, because that is where tricount puts it and because a
 * reader that goes hunting for a pattern anywhere in the string will find one
 * in the host. Returns null for anything that is not a key, and the screen
 * says so rather than sending it (`copy.importData.notTricount`).
 */
export function tricountKey(pasted: string): string | null {
  const text = pasted.trim();
  if (text === "") return null;
  // Everything after the last slash, with a query or a fragment taken off —
  // `tricount.com/abc?utm_source=x` is the link a chat app hands over.
  const tail = (text.split(/[?#]/)[0] ?? "").replace(/\/+$/, "").split("/").pop() ?? "";
  return /^[A-Za-z0-9]{6,64}$/.test(tail) ? tail : null;
}

/**
 * The public half of a throwaway RSA key.
 *
 * The handshake wants one and nothing ever signs with it, so the private half
 * is dropped on the floor here — which is also why it is made on the phone
 * rather than on the Worker: a key nobody keeps costs a phone nothing and
 * costs the Worker CPU on every import.
 */
async function clientKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  const bytes = new Uint8Array(spki);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const body = btoa(binary).replace(/(.{64})/g, "$1\n").trim();
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}

/**
 * Ask for the tricount behind a key. Writes nothing and holds nothing: what
 * comes back is handed straight to the reader, which hands back a plan.
 *
 * The three ways it fails are three different sentences, because they are
 * three different things to do about it: the link is wrong, the phone is off
 * the network, or an API nobody documents has moved.
 */
export async function fetchTricount(key: string): Promise<unknown> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new TricountOfflineError("offline");
  }
  let res: Response;
  try {
    res = await fetch("/api/tricount", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, clientKey: await clientKey() }),
    });
  } catch {
    // fetch only rejects when the request never reached a server, which is
    // offline by another name (`lib/rates.ts` says the same).
    throw new TricountOfflineError("unreachable");
  }

  if (res.status === 404) {
    throw new ImportError("not-tricount", "no tricount for that link");
  }
  if (!res.ok) throw new TricountDownError(`tricount endpoint answered ${res.status}`);

  try {
    return await res.json();
  } catch {
    throw new TricountDownError("tricount answered with something that isn't JSON");
  }
}
