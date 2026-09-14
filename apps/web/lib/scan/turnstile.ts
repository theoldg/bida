/**
 * Proof that a real browser is asking for a scan.
 *
 * Everything else in front of the scan endpoint counts a caller who agrees to
 * be counted: the credential is free to mint by design (ADR-0035), so a script
 * simply brings a new one. Turnstile is the check that cannot be opted out of,
 * and it is what lets the cheap credential stay cheap. The token is single-use
 * and short-lived, so one is fetched per scan and never cached.
 *
 * **Fail closed.** A blocked script means no token and no scan, named as such
 * (`copy.scan.unverified`) rather than dressed up as a failed photo. Failing
 * open would make the check optional for exactly the people who want it to be.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The script never loaded, the widget never answered, or it answered "no". */
export class TurnstileBlockedError extends Error {}

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
 * A fresh token, or null where Turnstile isn't configured — a self-hosted
 * deployment with no site key, whose Worker has no secret either and so is not
 * checking (SELFHOSTING.md). Never null on a deployment that has one.
 *
 * The widget is rendered into a fixed host at the foot of the screen rather
 * than off-screen: `interaction-only` draws nothing at all in the ordinary
 * case, but a challenge that *does* need a tap has to be somewhere a thumb can
 * reach it, or the scan waits out its timeout for a checkbox nobody can see.
 */
export async function turnstileToken(): Promise<string | null> {
  if (!SITE_KEY) return null;
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
      });
      if (id === undefined) fail("turnstile would not render")();
    });
  } finally {
    if (id !== undefined) turnstile.remove(id);
    host.remove();
  }
}
