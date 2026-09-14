/**
 * Proof that a real browser is asking for a scan.
 *
 * Everything else in front of the scan endpoint counts a caller who agrees to
 * be counted: the credential is free to mint by design (ADR-0035), so a script
 * simply brings a new one. Turnstile is the check that cannot be opted out of,
 * and it is what lets the cheap credential stay cheap.
 *
 * **Fail closed.** A blocked script means no token and no scan, named as such
 * (`copy.scan.unverified.browser`) rather than dressed up as a failed photo. Failing
 * open would make the check optional for exactly the people who want it to be.
 *
 * **One token is spent per scan**, which is not the same as minting one at the
 * press. A token is single-use and good for a few minutes, so the challenge
 * can run while a scan button is merely on screen and be waiting by the time
 * anybody photographs anything — `warmTurnstile`. What must not happen is two
 * scans sharing one: `turnstileToken` *takes* the warmed token, so the slot is
 * empty behind it and the next scan mints again.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * How long a warmed token may sit before it is thrown away unspent.
 *
 * Cloudflare gives a token 300s, and what has to be true is that it is still
 * valid when the *Worker* verifies it — which is after the press, the upload
 * and the queue behind it. Half the real life is the margin: a token older
 * than this is dropped and a fresh one minted at the press, which is exactly
 * what the code did before any of this.
 */
const WARM_TTL_MS = 120_000;

/**
 * No token, or a token the Worker would not accept.
 *
 * `side` is which end refused, because the two have nothing in common but the
 * outcome: `"browser"` is a script that never loaded or a widget that never
 * answered — the person's own network, and their retry might work. `"server"`
 * is a token this browser minted and the Worker's `siteverify` rejected, which
 * is a deployment whose secret and site key disagree
 * (docs/receipt-scanning.md#what-the-scan-costs) and no amount of retrying
 * fixes. Said as one sentence, the second reads as the first and sends the
 * wrong person looking.
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
 * The widget is rendered into a fixed host at the foot of the screen rather
 * than off-screen: `interaction-only` draws nothing at all in the ordinary
 * case, but a challenge that *does* need a tap has to be somewhere a thumb can
 * reach it, or the scan waits out its timeout for a checkbox nobody can see.
 *
 * Which is why `interactive` exists. A warm runs with it false and gives up
 * the moment Cloudflare wants a tap: a checkbox floating over the Items tab,
 * asked for by nobody, is worse than the second it would have saved. The
 * press runs with it true, where a challenge is something the person just
 * asked for and the widget appears in answer to it.
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
 * One challenge, shared by whoever asks while it runs.
 *
 * The token is filed into the slot *in the continuation that resolves this
 * promise*, so anybody awaiting it sees a filled slot rather than racing the
 * filing — which is what keeps `turnstileToken` from ever handing back a token
 * that is also still sitting in `warmed`, to be spent a second time.
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
 * Start the challenge now, so pressing a scan button doesn't wait for it.
 *
 * Called wherever a scan control is on screen and ready to press (`ScanPair`),
 * which is the honest reading of "about to scan" — the Items tab, `/g/scan`,
 * `/quick`, and the chip beside a bill already assigned.
 *
 * **It never throws and never reports.** A warm that fails has cost nobody
 * anything: the token is minted again at the press, and *that* is where a
 * blocked browser is named, on the screen of somebody who actually asked for
 * a scan. Warming is speculative, so it is also silent.
 */
export function warmTurnstile(): void {
  if (!SITE_KEY || typeof document === "undefined") return;
  if (minting || (warmed && Date.now() - warmed.at < WARM_TTL_MS)) return;
  void startMint().catch(() => { /* the press will say so, in this browser's words */ });
}

/**
 * A fresh token, or null where Turnstile isn't configured — a self-hosted
 * deployment with no site key, whose Worker has no secret either and so is not
 * checking (SELFHOSTING.md). Never null on a deployment that has one.
 *
 * Takes what `warmTurnstile` left, joins a warm still in flight, and otherwise
 * mints one here. Only the last path can throw, which is the one the person is
 * actually waiting on.
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
