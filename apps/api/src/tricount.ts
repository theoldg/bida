// Doc: docs/import-export.md#reading-a-tricount-back
/**
 * bunq's API is undocumented, so the three constants below are everything it
 * gates on, and worked against a real link — if this refuses, something moved.
 */

const BASE = "https://api.tricount.bunq.com/v1";

const USER_AGENT = "com.bunq.tricount.android:RELEASE:7.0.7:3174:ANDROID:13:C";

/**
 * The one every published client sends; an untried value is one more way to fail
 * untested.
 */
const REQUEST_ID = "049bfcdf-6ae4-4cee-af7b-45da31ea85d0";

export const MAX_REGISTRY_BYTES = 8 * 1024 * 1024;

export function isTricountKey(key: unknown): key is string {
  return typeof key === "string" && /^[A-Za-z0-9]{6,64}$/.test(key);
}

/**
 * Caller input sent to someone else, so it is checked though nothing signs with
 * it.
 */
export function isClientKey(pem: unknown): pem is string {
  if (typeof pem !== "string" || pem.length > 2000) return false;
  const body = /^-----BEGIN PUBLIC KEY-----([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----\s*$/
    .exec(pem.trim())?.[1];
  if (!body) return false;
  const packed = body.replace(/\s/g, "");
  return packed.length >= 200 && packed.length <= 1400 && /^[A-Za-z0-9+/]+={0,2}$/.test(packed);
}

export interface TricountSession {
  token: string;
  userId: number;
}

/** An array of one-key objects in no promised order, so found by key. */
export function sessionFrom(payload: unknown): TricountSession | null {
  const response = (payload as { Response?: unknown })?.Response;
  if (!Array.isArray(response)) return null;
  let token: string | undefined;
  let userId: number | undefined;
  for (const item of response) {
    if (typeof item !== "object" || item === null) continue;
    const found = item as Record<string, unknown>;
    const inner = found["Token"];
    if (typeof inner === "object" && inner !== null) {
      const value = (inner as Record<string, unknown>)["token"];
      if (typeof value === "string") token = value;
    }
    for (const key of ["UserPerson", "UserCompany", "UserApiKey"]) {
      const user = found[key];
      if (typeof user === "object" && user !== null) {
        const id = (user as Record<string, unknown>)["id"];
        if (typeof id === "number") userId = id;
      }
    }
  }
  return token !== undefined && userId !== undefined ? { token, userId } : null;
}

function headers(appId: string, token?: string): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    "app-id": appId,
    "X-Bunq-Client-Request-Id": REQUEST_ID,
    "Content-Type": "application/json",
    ...(token ? { "X-Bunq-Client-Authentication": token } : {}),
  };
}

/**
 * `appId` is fresh per request: one shared installation is what a rate limit
 * targets.
 */
export async function openSession(clientKey: string, appId: string): Promise<TricountSession | null> {
  const res = await fetch(`${BASE}/session-registry-installation`, {
    method: "POST",
    headers: headers(appId),
    body: JSON.stringify({
      app_installation_uuid: appId,
      client_public_key: clientKey,
      device_description: "Android",
    }),
  });
  if (!res.ok) return null;
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return null;
  }
  return sessionFrom(payload);
}

export function fetchRegistry(
  session: TricountSession, key: string, appId: string,
): Promise<Response> {
  const url = `${BASE}/user/${session.userId}/registry`
    + `?public_identifier_token=${encodeURIComponent(key)}`;
  return fetch(url, { headers: headers(appId, session.token) });
}
