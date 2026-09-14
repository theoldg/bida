import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The warmed token, which is the one piece of this worth a test: it is
 * *shared mutable state holding a single-use credential*. Handing the same
 * token to two scans gets the second refused by the Worker with the sentence
 * reserved for a misconfigured deployment, and handing over one that has aged
 * out does the same — both on somebody's phone, at a table, mid-bill.
 */

/** What the fake widget hands back, one per challenge, so tokens are telling. */
let minted = 0;
/** How the next challenge behaves: answer, refuse, or never come back. */
let behaviour: "ok" | "fail" | "wants-a-tap" = "ok";
/** Whether the last render was willing to put a checkbox on screen. */
let lastInteractive = false;
let rendered = 0;

function fakeDom(): void {
  const script = { src: "", async: false, onload: null, onerror: null } as
    { src: string; async: boolean; onload: (() => void) | null; onerror: (() => void) | null };
  const host = { className: "", remove: () => {} };
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => (tag === "script" ? script : host),
    head: { appendChild: () => { queueMicrotask(() => script.onload?.()); } },
    body: { appendChild: () => {} },
  };
  (globalThis as Record<string, unknown>).window = {
    turnstile: {
      render: (_el: unknown, opts: Record<string, unknown>) => {
        rendered++;
        const done = opts.callback as (t: string) => void;
        const fail = opts["error-callback"] as () => void;
        const wantsTap = opts["before-interactive-callback"] as (() => void) | undefined;
        lastInteractive = wantsTap === undefined;
        if (behaviour === "ok") queueMicrotask(() => done(`token-${++minted}`));
        if (behaviour === "fail") queueMicrotask(() => fail());
        // Cloudflare decided this one needs a tap. A render that allowed it
        // carries on and answers; a warm has no callback to call and gives up.
        if (behaviour === "wants-a-tap") {
          queueMicrotask(() => (wantsTap ? wantsTap() : done(`token-${++minted}`)));
        }
        return "widget-1";
      },
      remove: () => {},
    },
  };
}

/** Fresh module state per test — the slot is module-level, which is the point. */
async function load() {
  vi.resetModules();
  minted = 0;
  rendered = 0;
  behaviour = "ok";
  lastInteractive = false;
  fakeDom();
  return await import("./turnstile");
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).window;
});

describe("warming", () => {
  it("hands the warmed token to the scan, with no second challenge", async () => {
    const { warmTurnstile, turnstileToken } = await load();
    warmTurnstile();
    await vi.waitFor(() => expect(minted).toBe(1));
    expect(await turnstileToken()).toBe("token-1");
    expect(rendered).toBe(1);
  });

  it("spends it once — a second scan mints its own", async () => {
    const { warmTurnstile, turnstileToken } = await load();
    warmTurnstile();
    await vi.waitFor(() => expect(minted).toBe(1));
    expect(await turnstileToken()).toBe("token-1");
    expect(await turnstileToken()).toBe("token-2");
  });

  it("warms once while one is already in hand", async () => {
    const { warmTurnstile } = await load();
    warmTurnstile();
    await vi.waitFor(() => expect(minted).toBe(1));
    warmTurnstile();
    warmTurnstile();
    expect(rendered).toBe(1);
  });

  it("throws away one too old to survive the round trip", async () => {
    const { warmTurnstile, turnstileToken } = await load();
    warmTurnstile();
    await vi.waitFor(() => expect(minted).toBe(1));
    vi.setSystemTime(Date.now() + 121_000);
    expect(await turnstileToken()).toBe("token-2");
  });

  it("joins a warm still running rather than starting a second", async () => {
    const { warmTurnstile, turnstileToken } = await load();
    warmTurnstile();
    const token = await turnstileToken();
    expect(token).toBe("token-1");
    expect(rendered).toBe(1);
  });

  it("is silent when it fails, and the press says so itself", async () => {
    const { warmTurnstile, turnstileToken, TurnstileBlockedError } = await load();
    behaviour = "fail";
    warmTurnstile();
    await vi.waitFor(() => expect(rendered).toBe(1));
    // Nothing was thrown out of the warm — it is the press that refuses, on
    // the screen of somebody who actually asked for a scan.
    await expect(turnstileToken()).rejects.toBeInstanceOf(TurnstileBlockedError);
    expect(rendered).toBe(2);
  });

  it("gives up rather than put a checkbox on screen nobody asked for", async () => {
    const { warmTurnstile, turnstileToken } = await load();
    behaviour = "wants-a-tap";
    warmTurnstile();
    await vi.waitFor(() => expect(rendered).toBe(1));
    expect(lastInteractive).toBe(false);
    // Nothing warmed, so the press runs the challenge itself — and that one
    // may draw the widget, because the person just asked for a scan.
    expect(await turnstileToken()).toBe("token-1");
    expect(lastInteractive).toBe(true);
  });

  it("does nothing at all without a site key", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    const { warmTurnstile, turnstileToken } = await load();
    warmTurnstile();
    expect(await turnstileToken()).toBeNull();
    expect(rendered).toBe(0);
  });
});
