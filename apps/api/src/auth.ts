/**
 * Link-only auth (ADR-0003) over a derived token (ADR-0036). The bearer is one
 * HKDF branch of the link secret; the key is the other. No variable here is
 * called `secret` — the Worker never receives one.
 */

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Extracts the token from `Authorization: Bearer <token>`, or null. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header);
  return match ? match[1]! : null;
}
