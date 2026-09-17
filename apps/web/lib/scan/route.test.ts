import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/dexie";
import { setGeminiKey } from "../db/device";
import { ScanKeyError, ScanLimitError, ScanOfflineError, scanReceipt } from "./index";

/**
 * Which way a scan leaves the phone.
 *
 * This is the whole of the bring-your-own-key feature: the reading, the form
 * it fills and the arithmetic after it are the same either way, and the only
 * thing that changes is who is called and what is sent with it. So what is
 * tested here is negative, and the negatives are the point — with a key of
 * their own, nothing of ours is asked, spent or told
 * (docs/receipt-scanning.md#a-key-of-your-own).
 *
 * The photo never gets resized here: the downscale is canvas work with no
 * standing in node, and nothing this file asserts depends on the bytes.
 */

vi.mock("./downscale", () => ({ downscaleToBase64Jpeg: () => Promise.resolve("QUJD") }));
// A warmed token is the shared path's, and minting one has no business
// happening on a path that sends none.
const minted = vi.fn(() => Promise.resolve("turnstile-token"));
vi.mock("./turnstile", () => ({
  turnstileToken: () => minted(),
  warmTurnstile: () => {},
  TurnstileBlockedError: class extends Error {},
}));

const KEY = "AIzaSyB1c2d3e4f5g6h7i8j9k0lmnopqrstuvwx";
const PHOTO = new Blob(["not really a jpeg"], { type: "image/jpeg" });

/** One bill Gemini could plausibly have read, in its own envelope. */
const answer = (result: Record<string, unknown>) =>
  new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
  }), { status: 200 });

const BILL = { title: "Bar Zahra", total: "12.00", currency: "EUR", date: "2026-09-18", lineItems: [], discounts: [] };

let calls: { url: string; init: RequestInit }[] = [];

function answering(make: (url: string) => Response) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(make(String(url)));
  }));
}

beforeEach(async () => {
  await db().device.clear();
  minted.mockClear();
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

describe("a phone with no key of its own", () => {
  it("goes through our Worker, with a bearer and a Turnstile token", async () => {
    answering(() => answer(BILL));
    const result = await scanReceipt(PHOTO, "g1", "s3cret", "EUR");

    expect(result.title).toBe("Bar Zahra");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/groups/g1/scan");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toMatch(/^Bearer /);
    expect(headers["X-Turnstile-Token"]).toBe("turnstile-token");
  });

  it("still refuses on its own copy of the budget", async () => {
    answering(() => answer(BILL));
    const { noteScan } = await import("./budget");
    for (let i = 0; i < 40; i++) await noteScan("g1");
    await expect(scanReceipt(PHOTO, "g1", "s3cret", "EUR")).rejects.toThrow(ScanLimitError);
  });
});

describe("a phone with a key of its own", () => {
  beforeEach(async () => { await setGeminiKey(KEY); });

  it("calls Google directly and never touches our Worker", async () => {
    answering(() => answer(BILL));
    const result = await scanReceipt(PHOTO, "g1", "s3cret", "EUR");

    expect(result.title).toBe("Bar Zahra");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("generativelanguage.googleapis.com");
    expect(calls.some((c) => c.url.startsWith("/api/"))).toBe(false);
  });

  it("sends the key, and the same envelope the Worker would have sent", async () => {
    answering(() => answer(BILL));
    await scanReceipt(PHOTO, "g1", "s3cret", "EUR");

    const { init } = calls[0]!;
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    const body = JSON.parse(String(init.body)) as { contents: { parts: unknown[] }[] };
    // core's envelope: one image, one instruction, and nothing a caller wrote.
    expect(body.contents[0]!.parts).toHaveLength(2);
    // The group's secret has no standing with Google and is not sent anywhere.
    expect(String(init.body)).not.toContain("s3cret");
  });

  it("mints no Turnstile token: there is no key of ours to protect", async () => {
    answering(() => answer(BILL));
    await scanReceipt(PHOTO, "g1", "s3cret", "EUR");
    expect(minted).not.toHaveBeenCalled();
  });

  it("is not stopped by a budget of ours that is already spent", async () => {
    answering(() => answer(BILL));
    const { noteScan } = await import("./budget");
    for (let i = 0; i < 40; i++) await noteScan("g1");
    await expect(scanReceipt(PHOTO, "g1", "s3cret", "EUR")).resolves.toMatchObject({ title: "Bar Zahra" });
  });

  it("spends nothing from our budget either, so the shared path is unaffected", async () => {
    answering(() => answer(BILL));
    await scanReceipt(PHOTO, "g1", "s3cret", "EUR");
    const { overCallerBudget } = await import("./budget");
    expect((await db().device.get("device"))?.scanLog ?? []).toHaveLength(0);
    expect(await overCallerBudget("g1")).toBe(false);
  });

  it("says the key was refused, not that the receipt was bad", async () => {
    answering(() => new Response("{}", { status: 400 }));
    await expect(scanReceipt(PHOTO, "g1", "s3cret", "EUR"))
      .rejects.toMatchObject({ why: "refused" });
  });

  it("tells a spent quota from a refused key", async () => {
    answering(() => new Response("{}", { status: 429 }));
    const err = await scanReceipt(PHOTO, "g1", "s3cret", "EUR").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScanKeyError);
    expect((err as ScanKeyError).why).toBe("spent");
  });

  it("is still offline when the phone is", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    answering(() => answer(BILL));
    await expect(scanReceipt(PHOTO, "g1", "s3cret", "EUR")).rejects.toThrow(ScanOfflineError);
    expect(calls).toHaveLength(0);
  });
});
