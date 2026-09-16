/**
 * "Add it to your home screen" — the one piece of browser state behind the
 * install nudge.
 *
 * Chrome fires `beforeinstallprompt` once, early, and only that same event
 * object can open the install sheet later. Miss it and there is no way to ask
 * again, so the listener goes on at module load rather than in an effect, and
 * the event waits here for whichever screen wants it. Safari fires nothing at
 * all: on iOS the only install path is the share sheet, which is why the
 * "manual" offer exists.
 */

/** What, if anything, this browser lets us offer. */
export type InstallOffer =
  /** Already running from the home screen. */
  | "installed"
  /** A captured prompt: one tap installs it. */
  | "ready"
  /** No API — say where the button is (iOS). */
  | "manual"
  /** Nothing to offer: a desktop browser, or one that neither installs nor tells us. */
  | "none";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * The decision itself, as a function of three facts — pure, so the awkward
 * combinations (iOS Safari already installed, Chrome that never fired) are
 * testable without a browser.
 */
export function offerFrom(
  { standalone, hasPrompt, ios }: { standalone: boolean; hasPrompt: boolean; ios: boolean },
): InstallOffer {
  if (standalone) return "installed";
  if (hasPrompt) return "ready";
  return ios ? "manual" : "none";
}

/** iPadOS 13+ calls itself a Mac. Touch points are what give it away. */
export function looksIos(ua: string, platform: string, touchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && touchPoints > 1);
}

/**
 * Whether `/join` asks "install first?" before the group opens. Only an iOS tab,
 * which forgets; and never for a group this phone already said who it is in, or
 * already chose to keep here — the choice is made once per group, not per tap.
 */
export function asksBeforeJoin(
  { offer, claimed, continued }: { offer: InstallOffer; claimed: boolean; continued: boolean },
): boolean {
  return offer === "manual" && !claimed && !continued;
}

let captured: InstallPromptEvent | undefined;
let installed = false;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Without this Chrome shows its own mini-infobar, which is the OS menu
    // version of the button we are about to draw ourselves.
    event.preventDefault();
    captured = event as InstallPromptEvent;
    announce();
  });
  window.addEventListener("appinstalled", () => {
    captured = undefined;
    installed = true;
    announce();
  });
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** A string, not an object: `useSyncExternalStore` compares snapshots by identity. */
export function installOffer(): InstallOffer {
  if (typeof window === "undefined") return "none";
  return offerFrom({
    standalone: installed || isStandalone(),
    hasPrompt: captured !== undefined,
    ios: looksIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
  });
}

/**
 * Running from the home screen on iOS: the one place a join link can't be
 * opened by tapping it. iOS hands every tapped link to Safari, whose storage is
 * not the home-screen app's, so the app never sees the invite — the groups list
 * offers to paste one instead. Android opens links in scope inside the
 * installed app, and a browser tab receives them directly.
 */
export function iosHomeScreenApp(): boolean {
  if (typeof window === "undefined") return false;
  return isStandalone() && looksIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    // Safari's own flag, and the only signal iOS gives.
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Open the browser's install sheet. Resolves once the person has answered.
 * The captured event is spent either way — the spec allows one prompt per
 * event, and Chrome fires a fresh one if it decides to offer again.
 */
export async function promptInstall(): Promise<boolean> {
  const event = captured;
  if (!event) return false;
  captured = undefined;
  announce();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}
