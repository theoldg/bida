// Doc: docs/scan-worker.md#what-the-scan-costs

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Cloudflare gives 300s, and it must still be valid when the Worker verifies it
 * after the upload.
 */
const WARM_TTL_MS = 120_000;

/**
 * `"browser"` is a widget that never answered, and a retry may work; `"server"`
 * is a secret and site key that disagree, which no retry fixes.
 */
export class TurnstileBlockedError extends Error {
  constructor(message: string, readonly side: "browser" | "server" = "browser") {
    super(message);
  }
}

interface Turnstile {
  render(el: HTMLElement, opts: Record<string, unknown>): string | undefined;
  remove(id: string): void;
}

declare global {
  interface Window { turnstile?: Turnstile }
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  // Not memoised across a failure, or one dead radio would be permanent.
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new TurnstileBlockedError("turnstile script blocked"));
    document.head.appendChild(el);
  }).catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

/**
 * In a fixed host on screen, never off it: a challenge needing a tap must be
 * reachable. A warm gives up on one — an unasked-for checkbox is worse than the
 * second saved.
 */
async function mint(interactive: boolean): Promise<string> {
  await loadScript();
  const turnstile = window.turnstile;
  if (!turnstile) throw new TurnstileBlockedError("turnstile script loaded but defined nothing");

  const host = document.createElement("div");
  host.className = "turnstile";
  document.body.appendChild(host);
  let id: string | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      const fail = (why: string) => () => {
        clearTimeout(timer);
        reject(new TurnstileBlockedError(why));
      };
      const timer = setTimeout(fail("turnstile timed out"), 45_000);
      id = turnstile.render(host, {
        sitekey: SITE_KEY,
        appearance: "interaction-only",
        callback: (token: string) => { clearTimeout(timer); resolve(token); },
        "error-callback": fail("turnstile refused"),
        "timeout-callback": fail("turnstile timed out"),
        ...(interactive ? {} : { "before-interactive-callback": fail("turnstile wants a tap") }),
      });
      if (id === undefined) fail("turnstile would not render")();
    });
  } finally {
    if (id !== undefined) turnstile.remove(id);
    host.remove();
  }
}

let warmed: { token: string; at: number } | null = null;
let minting: Promise<string> | null = null;

/** Takes it: a token is single-use. */
function takeWarmed(): string | null {
  if (!warmed) return null;
  const { token, at } = warmed;
  warmed = null;
  return Date.now() - at < WARM_TTL_MS ? token : null;
}

/**
 * Filed in the continuation that resolves this promise, so awaiters see the
 * filled slot.
 */
function startMint(): Promise<string> {
  if (minting) return minting;
  const run = mint(false).then(
    (token) => { warmed = { token, at: Date.now() }; minting = null; return token; },
    (err) => { minting = null; throw err; },
  );
  minting = run;
  return run;
}

/** Never throws or reports: a failed warm costs nothing. */
export function warmTurnstile(): void {
  if (!SITE_KEY || typeof document === "undefined") return;
  if (minting || (warmed && Date.now() - warmed.at < WARM_TTL_MS)) return;
  void startMint().catch(() => { /* the press will say so, in this browser's words */ });
}

/**
 * Null where Turnstile isn't configured (a self-hosted deployment,
 * SELFHOSTING.md).
 */
export async function turnstileToken(): Promise<string | null> {
  if (!SITE_KEY) return null;
  const ready = takeWarmed();
  if (ready) return ready;
  if (minting) {
    try {
      await minting;
      const token = takeWarmed();
      if (token) return token;
    } catch { /* mint again below */ }
  }
  return await mint(true);
}
