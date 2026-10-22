import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/dexie";
import { setGeminiKey, updateDevice } from "../db/device";
import { checkGeminiKey, maskKey, ownKey } from "./key";

/**
 * The key a phone brings itself. Two things here are worth being sure of, and
 * neither is arithmetic.
 *
 * The first is that a key is never *shown*: this app's diagnostics are pasted
 * into chat threads and its screenshots go in bug reports, so the masked form
 * has to stay unusable however short or odd the thing pasted was.
 *
 * The second is that the two refusals stay apart. "Google said no" and "this
 * browser cannot reach Google" ask different people to do different things,
 * and collapsing them is how somebody spends an evening re-typing a key that
 * was right all along.
 */

const KEY = "AIzaSyB1c2d3e4f5g6h7i8j9k0lmnopqrstuvwx";

afterEach(() => vi.unstubAllGlobals());

describe("maskKey", () => {
  it("shows enough of a real key to tell which one it is", () => {
    expect(maskKey(KEY)).toBe("AIzaSy…uvwx");
  });

  it("never shows enough to use", () => {
    expect(maskKey(KEY)).not.toContain(KEY.slice(6, -4));
    expect(maskKey(KEY).length).toBeLessThan(KEY.length);
  });

  it("hides something too short to be a key outright", () => {
    // Usually the wrong thing off a clipboard, and revealing most of a short
    // secret is worse than revealing none of it.
    expect(maskKey("hunter2")).toBe("•••••••");
    expect(maskKey("hunter2")).not.toContain("h");
  });
});

describe("checkGeminiKey", () => {
  /** Each host answers for itself: a status, or a request that never arrives. */
  const answering = (hosts: { vertex: number | "blocked"; aiStudio: number | "blocked" }) => {
    const fetched = vi.fn((url: string) => {
      const answer = url.includes("aiplatform") ? hosts.vertex : hosts.aiStudio;
      return answer === "blocked"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(new Response("", { status: answer }));
    });
    vi.stubGlobal("fetch", fetched);
    return fetched;
  };

  it("accepts an AI Studio key, and says where it goes", async () => {
    answering({ vertex: 401, aiStudio: 200 });
    expect(await checkGeminiKey(KEY)).toEqual({ ok: true, host: "ai-studio" });
  });

  it("accepts a Vertex key, and says where it goes", async () => {
    answering({ vertex: 200, aiStudio: 400 });
    expect(await checkGeminiKey(KEY)).toEqual({ ok: true, host: "vertex" });
  });

  it("sends a key both answer for to Vertex, where the Cloud credit is", async () => {
    answering({ vertex: 200, aiStudio: 200 });
    expect(await checkGeminiKey(KEY)).toEqual({ ok: true, host: "vertex" });
  });

  it("takes a key out of quota for the right key", async () => {
    answering({ vertex: 429, aiStudio: 400 });
    expect(await checkGeminiKey(KEY)).toEqual({ ok: true, host: "vertex" });
  });

  it("carries the key in the header and nowhere else", async () => {
    const fetched = answering({ vertex: 200, aiStudio: 200 });
    await checkGeminiKey(KEY);
    expect(fetched).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetched.mock.calls as unknown as [string, RequestInit][]) {
      // Not in the query string: a URL is logged by every proxy on the way.
      expect(url).not.toContain(KEY);
      expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    }
  });

  it("calls a refusal from both a refusal", async () => {
    answering({ vertex: 401, aiStudio: 400 });
    expect(await checkGeminiKey(KEY)).toEqual({ ok: false, why: "refused" });
  });

  it("calls a browser that cannot reach Google at all something else", async () => {
    // A content blocker, a shield, a proxy: the key may be perfect, and saying
    // "Google refused it" would send somebody after the wrong thing.
    answering({ vertex: "blocked", aiStudio: "blocked" });
    expect(await checkGeminiKey(KEY)).toEqual({ ok: false, why: "blocked" });
  });

  it("won't call a key refused when the host it may belong to was out of reach", async () => {
    answering({ vertex: "blocked", aiStudio: 400 });
    expect(await checkGeminiKey(KEY)).toEqual({ ok: false, why: "blocked" });
  });
});

describe("the key on this phone", () => {
  beforeEach(async () => { await db().device.clear(); });

  it("is absent until one is pasted, which is 'use the shared key'", async () => {
    expect(await ownKey()).toBeUndefined();
  });

  it("survives the trip through the device record, with its host", async () => {
    await setGeminiKey(KEY, "vertex");
    expect(await ownKey()).toEqual({ key: KEY, host: "vertex" });
  });

  it("goes to AI Studio when saved before there were two hosts", async () => {
    await updateDevice({ geminiKey: KEY });
    expect(await ownKey()).toEqual({ key: KEY, host: "ai-studio" });
  });

  it("loses what a clipboard adds", async () => {
    await setGeminiKey(`  ${KEY}\n`);
    expect((await ownKey())?.key).toBe(KEY);
  });

  it("is gone for good when removed, not stored empty", async () => {
    await setGeminiKey(KEY);
    await setGeminiKey(undefined);
    expect(await ownKey()).toBeUndefined();
    // Whitespace is a removal too: an emptied field is not a key.
    await setGeminiKey(KEY);
    await setGeminiKey("   ");
    expect(await ownKey()).toBeUndefined();
  });
});
