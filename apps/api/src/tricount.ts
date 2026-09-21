/**
 * The two calls that turn a tricount link into the JSON behind it.
 *
 * Tricount is bunq's, and its app talks to an API nobody documents: no key, no
 * account, but a **handshake** — register an installation, get a token back,
 * then ask for the registry the link's `public_identifier_token` names. Both
 * calls are composed here; `index.ts` is the route, `core/tricount.ts` reads
 * what comes back, and neither knows about the other.
 *
 * **It sits on the Worker for the reason `/api/rates` does**: a browser cannot
 * call `api.tricount.bunq.com` — it answers no preflight — and a passthrough
 * of ours is also the one place that changes if bunq moves the endpoint. What
 * it is *not* is a place the group is read: the body is streamed back to the
 * phone untouched and nothing is stored, which is the same promise
 * [ADR-0036](../../../docs/decisions/0036-the-server-cannot-read-a-group.md)
 * makes about our own groups, kept here by having nowhere to put one.
 *
 * **Undocumented means it can stop working**, and the refusal a person sees
 * says so rather than blaming their link (`copy.importData.refused`). What it
 * cannot do is cost anything: there is no key here to spend. The three
 * constants below are the whole of what bunq gates on, and **a real link came
 * back on them** (2026-09-21) — so a session that finds this refusing is
 * looking at something that moved, not at a guess that was always wrong.
 */

const BASE = "https://api.tricount.bunq.com/v1";

/**
 * The app the handshake claims to be. bunq gates on it, so it is the app's own
 * string and not ours — the export tools this was built from all send it, and
 * a Worker that sent something else would be refused rather than anonymous.
 */
const USER_AGENT = "com.bunq.tricount.android:RELEASE:7.0.7:3174:ANDROID:13:C";

/**
 * A per-request id the handshake wants. Constant, and deliberately the one
 * every published client sends: it is not deduplicated — those clients would
 * answer once and never again if it were — and a value nobody has tried is one
 * more way for this to fail that no test of ours would catch.
 */
const REQUEST_ID = "049bfcdf-6ae4-4cee-af7b-45da31ea85d0";

/** Big enough for any ledger, small enough that nothing here is a pipe. */
export const MAX_REGISTRY_BYTES = 8 * 1024 * 1024;

/**
 * The part of a tricount link that identifies it: what follows the last slash
 * of `tricount.com/tltMJWkWWUUxhUlzFm`. Letters and digits only — the phone
 * pulls it out of whatever was pasted (`lib/import/tricount.ts`) and this is
 * the check that the thing reaching bunq is still one.
 */
export function isTricountKey(key: unknown): key is string {
  return typeof key === "string" && /^[A-Za-z0-9]{6,64}$/.test(key);
}

/**
 * The public half of a throwaway RSA key, PEM, made on the phone.
 *
 * The handshake wants one and **nothing ever signs with it** — no call in this
 * protocol is signed — so the private half is discarded where it was made and
 * this is inert bytes. Checked all the same, because it is the one thing a
 * caller gets to put in a request we make to somebody else: armour, base64,
 * and the size a 2048-bit SPKI key is.
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
 * The token and the user out of the handshake's reply, which is an array of
 * one-key objects in an order the API does not promise. Found by key, never by
 * position, for the reason `import.ts` finds the foot row by its description.
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
    // The handshake registers a person, and which flavour of one it calls them
    // is not ours to depend on.
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
 * Register an installation. `appId` is fresh per request — it is the one thing
 * the published clients do vary, and one installation shared by everybody
 * opening a tricount through bida is exactly the shape a rate limit is for.
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

/** The registry the link names, as bunq answers it. Not read here — see the head of the file. */
export function fetchRegistry(
  session: TricountSession, key: string, appId: string,
): Promise<Response> {
  const url = `${BASE}/user/${session.userId}/registry`
    + `?public_identifier_token=${encodeURIComponent(key)}`;
  return fetch(url, { headers: headers(appId, session.token) });
}
