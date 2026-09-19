import { getDevice } from "../db/device";

/**
 * The key this phone scans with, when it is not ours.
 *
 * Bringing one changes where the scan goes, not what it says: same envelope
 * (`@bida/core`), same model, so everything downstream is untouched. What it
 * drops is what exists to protect a *shared* key — the bearer token,
 * Turnstile, all three budget buckets — none of which guards anything here
 * (docs/receipt-scanning.md#a-key-of-your-own).
 */

/** Where a key is checked. Listing models is free and needs no quota. */
const MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** The key this phone brought, or undefined to use the shared one. */
export async function ownKey(): Promise<string | undefined> {
  return (await getDevice()).geminiKey;
}

/**
 * A key for showing: enough of it to recognise which one is pasted, never
 * enough to use. Short input is masked whole rather than mostly revealed —
 * what is too short to be a key is usually the wrong thing off a clipboard.
 */
export function maskKey(key: string): string {
  return key.length < 16 ? "•".repeat(key.length) : `${key.slice(0, 6)}…${key.slice(-4)}`;
}

/**
 * Why a key was not accepted. Two answers, because they need two different
 * things done about them. `blocked` is the one worth naming: a brought key is
 * a call this browser makes itself, so a content blocker or a network refusing
 * `googleapis.com` makes the feature impossible here — better found at the
 * paste than three days later over a real receipt.
 */
export type KeyRefusal = "refused" | "blocked";

/**
 * Ask Google whether this key works — one free request, and the reason
 * `/advanced` will not store a key it has not seen answer. Proves two things:
 * that the key is a key, and that this browser can reach Google at all.
 */
export async function checkGeminiKey(key: string): Promise<{ ok: true } | { ok: false; why: KeyRefusal }> {
  let res: Response;
  try {
    res = await fetch(MODELS_URL, { headers: { "x-goog-api-key": key } });
  } catch {
    // fetch only rejects when the request never reached a server — blocked,
    // proxied, or a dead radio. Not a verdict on the key.
    return { ok: false, why: "blocked" };
  }
  return res.ok ? { ok: true } : { ok: false, why: "refused" };
}
