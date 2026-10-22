import { VERTEX_URL } from "@bida/core";
import { getDevice } from "../db/device";
import type { KeyHost } from "../db/dexie";

/**
 * The key this phone scans with, when it is not ours. Same envelope
 * (`@bida/core`) and model, so everything downstream is untouched; it skips
 * what protects the *shared* key — bearer token, Turnstile, budget buckets
 * (docs/scan-worker.md#a-key-of-your-own).
 */

/** Where an AI Studio key is checked. Listing models is free and needs no quota. */
const MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Vertex lists nothing for an API key, so it is asked the real question in a
 * few tokens — a fraction of a cent on the key's own bill.
 */
const VERTEX_PROBE = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Say OK." }] }] });

/** The key this phone brought and where it goes, or undefined to use the shared one. */
export async function ownKey(): Promise<{ key: string; host: KeyHost } | undefined> {
  const { geminiKey, geminiHost } = await getDevice();
  return geminiKey ? { key: geminiKey, host: geminiHost ?? "ai-studio" } : undefined;
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
 * Ask both of Google's hosts whether this key works; `/advanced` won't store a
 * key neither has answered for. Both, because a key's look doesn't say which
 * it is, and **Vertex wins a tie**: a Cloud key that AI Studio also lists
 * models for is billed there against a prepay balance the Cloud credit can't
 * fill (docs/scan-worker.md#a-key-of-your-own).
 */
export async function checkGeminiKey(key: string): Promise<{ ok: true; host: KeyHost } | { ok: false; why: KeyRefusal }> {
  const [vertex, aiStudio] = await Promise.all([
    ask(VERTEX_URL, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: VERTEX_PROBE }),
    ask(MODELS_URL, { headers: { "x-goog-api-key": key } }),
  ]);
  if (vertex === "ok") return { ok: true, host: "vertex" };
  if (aiStudio === "ok") return { ok: true, host: "ai-studio" };
  // Blocked from either says nothing about the key, which may be that host's.
  return { ok: false, why: vertex === "blocked" || aiStudio === "blocked" ? "blocked" : "refused" };
}

async function ask(url: string, init: RequestInit): Promise<"ok" | KeyRefusal> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    // fetch only rejects when the request never reached a server — blocked,
    // proxied, or a dead radio. Not a verdict on the key.
    return "blocked";
  }
  // A 429 is a key Google knows, out of quota this minute: still the right key.
  return res.ok || res.status === 429 ? "ok" : "refused";
}
