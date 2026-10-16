// Doc: docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md
import { deriveSplitCrypto, openSplit, SealError, sealSplit, type SharedSplit } from "@bida/core";

/**
 * A quick split handed over as a link (ADR-0035):
 *
 *   https://bida.bid/split#7f2kq9x0m3v8n1zc
 *
 * The fragment is a secret shaped like a group's (`newGroupSecret`) and the
 * whole of the link: the row's address, the bearer and the key are all derived
 * from it (`deriveSplitCrypto`), so the server is handed none of it. One token
 * and no dot, which is what keeps `handoverFrom` from taking it for a carry.
 */

const isSecret = (x: string) => /^[A-Za-z0-9_-]+$/.test(x);

export function formatSplitLink(secret: string, origin = window.location.origin): string {
  return `${origin}/split#${secret}`;
}

/** A whole URL or just the fragment; null on anything else. */
export function parseSplitLink(input: string): string | null {
  const secret = input.includes("#") ? input.slice(input.indexOf("#") + 1) : input;
  return isSecret(secret) ? secret : null;
}

/** A press waits on this at most: a hung request would spin the button forever. */
const PATIENCE_MS = 15_000;

/** `offline` is no answer at all; `refused` is the server's no. */
export type Shared = "shared" | "offline" | "refused";

/** Seal the split and store it under the link's address. Again is a no-op. */
export async function shareSplit(secret: string, split: SharedSplit): Promise<Shared> {
  const crypto = await deriveSplitCrypto(secret);
  const sealed = await sealSplit(crypto, split);
  try {
    const res = await fetch(`/api/splits/${crypto.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${crypto.token}` },
      body: JSON.stringify({ sealed }),
      signal: AbortSignal.timeout(PATIENCE_MS),
    });
    return res.ok ? "shared" : "refused";
  } catch {
    return "offline";
  }
}

export type Fetched =
  | { kind: "split"; split: SharedSplit }
  /** No row: a link cut short in a chat, or a split removed. */
  | { kind: "none" }
  | { kind: "offline" }
  /** A row this build can't open: a newer build's, or not a split at all. */
  | { kind: "unreadable" };

export async function fetchSplit(secret: string): Promise<Fetched> {
  const crypto = await deriveSplitCrypto(secret);
  let res: Response;
  try {
    res = await fetch(`/api/splits/${crypto.id}`, { signal: AbortSignal.timeout(PATIENCE_MS) });
  } catch {
    return { kind: "offline" };
  }
  if (res.status === 404) return { kind: "none" };
  if (!res.ok) return { kind: "offline" };
  try {
    const { sealed } = await res.json() as { sealed?: unknown };
    if (typeof sealed !== "string") return { kind: "unreadable" };
    return { kind: "split", split: await openSplit(crypto, sealed) };
  } catch (err) {
    if (err instanceof SealError || err instanceof SyntaxError) return { kind: "unreadable" };
    throw err;
  }
}
