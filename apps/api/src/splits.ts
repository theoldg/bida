// Doc: docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md

/**
 * A quick split handed over as a link: one sealed row, written once by the
 * phone that shares it and read by anybody holding the link. Like a group's
 * ops, nothing here can read it (ADR-0036); unlike them, nothing amends it.
 */

/** `deriveSplitCrypto`'s id: nothing else is a row's key. */
export function isSplitId(id: string): boolean {
  return /^[0-9a-f]{32}$/.test(id);
}

/**
 * The push's ceiling for one op, and for the same reason: far past honest
 * (a 120-line bill among twelve is ~2 KB deflated, ~130 KB where the browser
 * can't deflate) and far under D1's 2 MB row.
 */
export const MAX_SPLIT_SEALED = 256_000;

type Outcome = "ok" | "wrong token";

/**
 * Idempotent: the id is the secret's, so a second write of one is the same
 * phone pressing again, and the first body stands. A token that disagrees
 * names a row it doesn't hold.
 */
export async function putSplit(
  db: D1Database, id: string, tokenHash: string, sealed: string, now: number,
): Promise<Outcome> {
  const held = await db.prepare("SELECT token_hash FROM splits WHERE id = ?").bind(id)
    .first<{ token_hash: string }>();
  if (held) return held.token_hash === tokenHash ? "ok" : "wrong token";
  await db.prepare(
    "INSERT INTO splits (id, token_hash, sealed, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
  ).bind(id, tokenHash, sealed, now).run();
  return "ok";
}

export async function getSplit(db: D1Database, id: string): Promise<string | null> {
  const row = await db.prepare("SELECT sealed FROM splits WHERE id = ?").bind(id).first<{ sealed: string }>();
  return row?.sealed ?? null;
}

/** Gone for good: nothing pushes a split back, so no tombstone is owed. */
export async function deleteSplit(db: D1Database, id: string, tokenHash: string): Promise<Outcome | "unknown"> {
  const held = await db.prepare("SELECT token_hash FROM splits WHERE id = ?").bind(id)
    .first<{ token_hash: string }>();
  if (!held) return "unknown";
  if (held.token_hash !== tokenHash) return "wrong token";
  await db.prepare("DELETE FROM splits WHERE id = ?").bind(id).run();
  return "ok";
}
