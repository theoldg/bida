import { ImportError } from "@bida/core";

/**
 * A tricount link, fetched. What the JSON *means* is `core/readTricount`'s
 * job; this file is the link, the key pair and one request
 * (docs/frontend.md#bringing-a-group-onto-the-phone).
 *
 * It goes through our Worker because bunq's reply carries no
 * `Access-Control-Allow-Origin`, so a page can't read it.
 * `apps/api/src/tricount.ts` is the other half.
 */

/** Our Worker could not reach tricount, or tricount would not talk to it. */
export class TricountDownError extends Error {}

/** This phone could not reach us. Said differently from tricount being down. */
export class TricountOfflineError extends Error {}

/**
 * The key out of whatever was pasted: a link, a link with tracking, or a bare
 * key. The last path segment — hunting for a pattern anywhere would match the
 * host. Null for anything else (`copy.importData.notTricount`).
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
 * The public half of a throwaway RSA key. The handshake wants one and nothing
 * signs with it, so the private half is dropped; made on the phone so the
 * Worker doesn't spend CPU on it every import.
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
 * Ask for the tricount behind a key; writes and holds nothing. Three failures,
 * three messages, because each needs a different fix: wrong link, offline, or
 * an undocumented API that moved.
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
