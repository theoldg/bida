/**
 * Link-only auth (ADR-0003), over a token the phone derives (ADR-0036).
 *
 * The bearer is not the group's link secret: it is one HKDF branch of it, and
 * the branch that opens the ops is the other one. So there is deliberately no
 * variable called `secret` in this Worker — it never receives one.
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
