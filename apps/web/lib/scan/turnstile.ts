/**
 * Proof that a real browser is asking for a scan. The scan credential is free
 * to mint by design (ADR-0035), so everything else can be dodged by minting a
 * new one; Turnstile can't be opted out of.
 *
 * **Fail closed.** No token, no scan, named as such
 * (`copy.scan.unverified.browser`). Failing open makes the check optional for
 * exactly the people it targets.
 *
 * **One token per scan**, not minted at the press: a token is single-use and
 * lasts minutes, so it is warmed while a scan button is on screen
 * (`warmTurnstile`). `turnstileToken` *takes* it, so two scans never share one.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * How long a warmed token may sit unspent. Cloudflare gives 300s, and it must
 * still be valid when the Worker verifies it after the upload — half is the
 * margin.
 */
const WARM_TTL_MS = 120_000;

/**
 * No token, or one the Worker rejected. `side` says which end: `"browser"` is
 * a script or widget that never answered — their network, and a retry may
 * work. `"server"` is `siteverify` rejecting our token: a deployment whose
 * secret and site key disagree (docs/receipt-scanning.md#what-the-scan-costs),
 * which no retry fixes. One sentence for both sends the wrong person looking.
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
  // Not memoised across a failure: a rejected promise kept here would make one
  // dead radio permanent, and the retry for a scan is the same button.
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
 * Run the widget once and resolve with what it says.
 *
 * **In a fixed host at the foot of the screen, never off-screen**:
 * `interaction-only` normally draws nothing, but a challenge needing a tap must
 * be reachable or the scan times out.
 *
 * A warm runs `interactive` false and gives up if Cloudflare wants a tap — an
 * unasked-for checkbox is worse than the second saved. The press runs true.
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
      // Longer than a scan, because a challenge that needs a tap is waiting on
      // a person; short enough that a widget which will never answer doesn't
      // leave the button reading "Reading…" forever.
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

/** A token minted ahead of the press, and when — see `WARM_TTL_MS`. */
let warmed: { token: string; at: number } | null = null;
/** A mint already in flight, so two warm calls are one challenge. */
let minting: Promise<string> | null = null;

/**
 * The warmed token if it is still young enough to survive the round trip,
 * else null. **Takes** it: a token is single-use, so the one thing worse than
 * minting again is two scans sending the same one.
 */
function takeWarmed(): string | null {
  if (!warmed) return null;
  const { token, at } = warmed;
  warmed = null;
  return Date.now() - at < WARM_TTL_MS ? token : null;
}

/**
 * One challenge, shared by whoever asks while it runs. The token is filed
 * *in the continuation that resolves this promise*, so awaiters see the filled
 * slot — or `turnstileToken` could return a token still sitting in `warmed`.
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

/**
 * Start the challenge now, wherever a scan control is ready (`ScanPair`).
 * **Never throws or reports**: a failed warm costs nothing, and the press
 * names a blocked browser to somebody who asked.
 */
export function warmTurnstile(): void {
  if (!SITE_KEY || typeof document === "undefined") return;
  if (minting || (warmed && Date.now() - warmed.at < WARM_TTL_MS)) return;
  void startMint().catch(() => { /* the press will say so, in this browser's words */ });
}

/**
 * A fresh token, or null where Turnstile isn't configured (a self-hosted
 * deployment with no site key, whose Worker isn't checking — SELFHOSTING.md).
 * Takes a warm token, joins a warm in flight, or mints — only the last throws.
 */
export async function turnstileToken(): Promise<string | null> {
  if (!SITE_KEY) return null;
  const ready = takeWarmed();
  if (ready) return ready;
  // A warm that is still running is this scan's token: waiting on it beats
  // starting a second challenge beside it. A warm that fails falls through to
  // a mint of our own, so the error belongs to this call and not to that one.
  if (minting) {
    try {
      await minting;
      const token = takeWarmed();
      if (token) return token;
    } catch { /* mint again below */ }
  }
  return await mint(true);
}
