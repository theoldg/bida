/**
 * The two calls turning a tricount link into its JSON. bunq's API is
 * undocumented: no key, but a **handshake** — register an installation, get a
 * token, then fetch the registry the link's `public_identifier_token` names.
 * `index.ts` routes; `core/tricount.ts` reads.
 *
 * On the Worker because bunq sends no `Access-Control-Allow-Origin`, and so
 * there is one place to change if the endpoint moves. The body is streamed
 * back untouched and nothing is stored, the same promise as ADR-0036.
 *
 * **Undocumented means it can stop working**; the refusal says so rather than
 * blaming the link (`copy.importData.refused`). The three constants below are
 * everything bunq gates on, and worked against a real link — if this refuses,
 * something moved.
 */

const BASE = "https://api.tricount.bunq.com/v1";

/** bunq gates on the user agent, so it is the app's own string, as other export tools send. */
const USER_AGENT = "com.bunq.tricount.android:RELEASE:7.0.7:3174:ANDROID:13:C";

/**
 * Constant, and the one every published client sends: it isn't deduplicated
 * (those clients would break if it were), and an untried value is one more
 * way to fail untested.
 */
const REQUEST_ID = "049bfcdf-6ae4-4cee-af7b-45da31ea85d0";

/** Big enough for any ledger, small enough that nothing here is a pipe. */
export const MAX_REGISTRY_BYTES = 8 * 1024 * 1024;

/**
 * The key part of a tricount link (after the last slash of
 * `tricount.com/tltMJWkWWUUxhUlzFm`). Alphanumeric only; the phone extracts it
 * (`lib/import/tricount.ts`), this checks it before it reaches bunq.
 */
export function isTricountKey(key: unknown): key is string {
  return typeof key === "string" && /^[A-Za-z0-9]{6,64}$/.test(key);
}

/**
 * The public half of a throwaway RSA key, made on the phone. Nothing ever
 * signs with it, but it is caller input sent to someone else, so it is checked:
 * PEM armour, base64, the size of a 2048-bit SPKI key.
 */
export function isClientKey(pem: unknown): pem is string {
  if (typeof pem !== "string" || pem.length > 2000) return false;
  const body = /^-----BEGIN PUBLIC KEY-----([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----\s*$/
    .exec(pem.trim())?.[1];
  if (!body) return false;
  const packed = body.replace(/\s/g, "");
  return packed.length >= 200 && packed.length <= 1400 && /^[A-Za-z0-9+/]+={0,2}$/.test(packed);
}

/** The session a handshake answered with: a token to send, and whose registry to ask for. */
export interface TricountSession {
  token: string;
  userId: number;
}

/**
 * The token and user from the handshake reply: an array of one-key objects in
 * no promised order, so found by key, never position.
 */
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
    // Which kind of user bunq registers isn't ours to depend on.
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
 * Register an installation. `appId` is fresh per request, as the published
 * clients vary it — one shared installation is what a rate limit targets.
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

/** The registry the link names, as bunq answers. Not read here. */
export function fetchRegistry(
  session: TricountSession, key: string, appId: string,
): Promise<Response> {
  const url = `${BASE}/user/${session.userId}/registry`
    + `?public_identifier_token=${encodeURIComponent(key)}`;
  return fetch(url, { headers: headers(appId, session.token) });
}
