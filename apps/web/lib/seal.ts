import { deriveGroupCrypto, type GroupCrypto } from "@bida/core";

/**
 * This phone's keys for a group, derived once and kept for the tab's life.
 *
 * The derivation (ADR-0036) is two HKDF passes and an `importKey` — microseconds,
 * but it is async, and every push, every pull and every scan wants it. Keyed by
 * the secret as well as the group id, so a device that opens a *new* invite
 * link for a group it already holds derives again instead of talking to the
 * server with the old link's token.
 *
 * The cache is a module-level `Map` rather than anything in Dexie on purpose:
 * the derived key is the one thing in this app that should never be written
 * down. Losing it on a reload costs a millisecond.
 */
const derived = new Map<string, Promise<GroupCrypto>>();

export function groupCrypto(groupId: string, secret: string): Promise<GroupCrypto> {
  const cacheKey = `${groupId}\n${secret}`;
  let pending = derived.get(cacheKey);
  if (!pending) {
    // The failure (no WebCrypto at all) is not cached: it is a property of the
    // page, not of this group, and a retry after it costs nothing.
    pending = deriveGroupCrypto(secret, groupId).catch((err: unknown) => {
      derived.delete(cacheKey);
      throw err;
    });
    derived.set(cacheKey, pending);
  }
  return pending;
}

/** The bearer this device sends for a group. Never the link secret itself. */
export async function groupToken(groupId: string, secret: string): Promise<string> {
  return (await groupCrypto(groupId, secret)).token;
}
