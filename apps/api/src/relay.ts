import { fromBase64, vapidAuthorization, type VapidKeys } from "@bida/core";
import { MAX_ENDPOINT_CHARS, MAX_NOTIFY_BYTES, MAX_NOTIFY_PER_PUSH } from "./push-limits";

/**
 * The relay that forgets (docs/notifications.md#the-decision): notifications
 * the sending phone already encrypted end to end are signed with our VAPID key
 * and forwarded. Nothing here is stored or logged — an endpoint lives for the
 * length of the request.
 */

/** One notification as the phone hands it over, `body` decoded from base64. */
export interface Notification {
  endpoint: string;
  body: Uint8Array;
}

/**
 * The push services' own hosts, and nowhere else — so neither our signature
 * nor the Worker's fetch can be pointed at an arbitrary URL. Chrome is FCM,
 * Safari is Apple, Firefox is Mozilla, Edge on Windows is WNS.
 */
const EXACT_HOSTS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com"]);
const HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"];

export function pushServiceAllowed(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return EXACT_HOSTS.has(host) || HOST_SUFFIXES.some((s) => host.endsWith(s));
}

/** A refused `notify` refuses the push whole, before any op is accepted. */
export interface NotifyRefusal {
  error: string;
  status: 400 | 413;
}

/**
 * Shape-check `notify: [{ endpoint, body }]`; absent is none. A host off the
 * list is *not* a refusal — a phone may hold a subscription from a push service
 * we don't know, and a refusal would stall its sync for ever — it is only not
 * forwarded (`relay` answers 0).
 */
export function parseNotify(raw: unknown): Notification[] | NotifyRefusal {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return { error: "notify must be an array", status: 400 };
  if (raw.length > MAX_NOTIFY_PER_PUSH) {
    return { error: `a push carries at most ${MAX_NOTIFY_PER_PUSH} notifications`, status: 413 };
  }
  const out: Notification[] = [];
  for (const item of raw) {
    const { endpoint, body } = (item ?? {}) as { endpoint?: unknown; body?: unknown };
    if (typeof endpoint !== "string" || endpoint.length > MAX_ENDPOINT_CHARS) {
      return { error: "a notification's endpoint is a URL", status: 400 };
    }
    if (typeof body !== "string") return { error: "a notification's body is base64", status: 400 };
    // On the text first, so an oversized string is never decoded.
    if (body.length > Math.ceil(MAX_NOTIFY_BYTES / 3) * 4) {
      return { error: `a notification is at most ${MAX_NOTIFY_BYTES} bytes`, status: 413 };
    }
    const bytes = fromBase64(body);
    if (!bytes || bytes.length === 0) return { error: "a notification's body is base64", status: 400 };
    if (bytes.length > MAX_NOTIFY_BYTES) {
      return { error: `a notification is at most ${MAX_NOTIFY_BYTES} bytes`, status: 413 };
    }
    out.push({ endpoint, body: bytes });
  }
  return out;
}

/** How long a push service holds a message for a phone that is off. A day-old share is still news. */
const TTL_SECONDS = 24 * 60 * 60;

/** Per push service; they run in parallel, so a slow one costs the sync this at most. */
export const RELAY_TIMEOUT_MS = 1000;

type Send = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Forward each notification and answer each endpoint's status. **0 is "not
 * delivered, and not the subscription's fault"**: a host off the list, a
 * timeout, a network error, no VAPID key on this Worker. Only `404`/`410` tells
 * the sender a subscription is dead. A repeated endpoint is sent once.
 *
 * One JWT per push service, not per message: an ES256 signature is the costly
 * part, and the free plan's CPU budget is milliseconds.
 */
export async function relay(
  notifications: readonly Notification[],
  vapid: VapidKeys | null,
  subject: string,
  now: number,
  send: Send = fetch,
): Promise<Record<string, number>> {
  const jwts = new Map<string, Promise<string>>();
  const signed = (origin: string, keys: VapidKeys) => {
    let jwt = jwts.get(origin);
    if (!jwt) {
      jwt = vapidAuthorization(origin, keys, subject, now);
      jwts.set(origin, jwt);
    }
    return jwt;
  };

  const one = async ({ endpoint, body }: Notification): Promise<number> => {
    if (!vapid || !pushServiceAllowed(endpoint)) return 0;
    try {
      const res = await send(endpoint, {
        method: "POST",
        headers: {
          authorization: await signed(new URL(endpoint).origin, vapid),
          ttl: String(TTL_SECONDS),
          "content-encoding": "aes128gcm",
          "content-type": "application/octet-stream",
        },
        body,
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      });
      // The push service's prose; nothing reads it.
      await res.body?.cancel();
      return res.status;
    } catch {
      // A timeout, the network, or a malformed VAPID key — ours to fix, never
      // the sync's to fail over.
      return 0;
    }
  };

  const unique = [...new Map(notifications.map((n) => [n.endpoint, n] as const)).values()];
  const statuses = await Promise.all(unique.map(one));
  return Object.fromEntries(unique.map((n, i) => [n.endpoint, statuses[i]!]));
}
