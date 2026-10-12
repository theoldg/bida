// Doc: docs/notifications.md
import { fromBase64, vapidAuthorization, type VapidKeys } from "@bida/core";
import { MAX_ENDPOINT_CHARS, MAX_NOTIFY_BYTES, MAX_NOTIFY_PER_BATCH } from "./push-limits";

export interface Notification {
  endpoint: string;
  body: Uint8Array;
}

/**
 * The push services' own hosts and nowhere else, so neither our signature nor the
 * fetch can be pointed at an arbitrary URL.
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

export interface NotifyRefusal {
  error: string;
  status: 400 | 413;
}

/**
 * A host off the list is not a refusal — a refusal would lose the whole batch
 * every time — only not forwarded.
 */
export function parseNotify(raw: unknown): Notification[] | NotifyRefusal {
  if (!Array.isArray(raw)) return { error: "notifications must be an array", status: 400 };
  if (raw.length > MAX_NOTIFY_PER_BATCH) {
    return { error: `a batch carries at most ${MAX_NOTIFY_PER_BATCH} notifications`, status: 413 };
  }
  const out: Notification[] = [];
  for (const item of raw) {
    const { endpoint, body } = (item ?? {}) as { endpoint?: unknown; body?: unknown };
    if (typeof endpoint !== "string" || endpoint.length > MAX_ENDPOINT_CHARS) {
      return { error: "a notification's endpoint is a URL", status: 400 };
    }
    if (typeof body !== "string") return { error: "a notification's body is base64", status: 400 };
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

const TTL_SECONDS = 24 * 60 * 60;

const RELAY_TIMEOUT_MS = 1000;

type Send = (url: string, init: RequestInit) => Promise<Response>;

/**
 * 0 is "not delivered, and not the subscription's fault"; only 404/410 tells the
 * sender a subscription is dead. One JWT per push service: ES256 is the costly
 * part.
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
      await res.body?.cancel();
      return res.status;
    } catch {
      return 0;
    }
  };

  const unique = [...new Map(notifications.map((n) => [n.endpoint, n] as const)).values()];
  const statuses = await Promise.all(unique.map(one));
  return Object.fromEntries(unique.map((n, i) => [n.endpoint, statuses[i]!]));
}
