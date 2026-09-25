import { getDevice } from "../db/device";

/**
 * The key this phone scans with, when it is not ours. Same envelope
 * (`@bida/core`) and model, so everything downstream is untouched; it skips
 * what protects the *shared* key — bearer token, Turnstile, budget buckets
 * (docs/scan-worker.md#a-key-of-your-own).
 */

/** Where a key is checked. Listing models is free and needs no quota. */
const MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** The key this phone brought, or undefined to use the shared one. */
export async function ownKey(): Promise<string | undefined> {
  return (await getDevice()).geminiKey;
}

/**
 * A key for showing: enough to recognise, never enough to use. Short input is
 * masked whole — too short for a key usually means the wrong clipboard.
 */
export function maskKey(key: string): string {
  return key.length < 16 ? "•".repeat(key.length) : `${key.slice(0, 6)}…${key.slice(-4)}`;
}

/**
 * Why a key was not accepted. `blocked` matters: a brought key is called by
 * this browser, so a content blocker refusing `googleapis.com` makes the
 * feature impossible here — better found at paste than over a real receipt.
 */
export type KeyRefusal = "refused" | "blocked";

/**
 * Ask Google whether this key works (one free request); `/advanced` won't
 * store a key it hasn't seen answer. Proves it is a key, and that this
 * browser can reach Google.
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
