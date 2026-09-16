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

import { formatInvites, formatJoinLink, type JoinLink } from "./group-link";

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
 * The iOS browser's name, for copy that is read at a glance. Every other iOS
 * browser (Firefox, Edge) marks itself, and an in-app web view drops the
 * `Safari/` token — so only an unmarked `Safari/` is Safari.
 */
export function iosBrowser(ua: string): "Safari" | "Chrome" | undefined {
  if (/CriOS\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && !/FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo|GSA\//.test(ua)) return "Safari";
  return undefined;
}

/**
 * Whether `/join` asks "add to home screen?" before the group opens. Only an iOS
 * tab, which forgets; never for a group this phone has said who it is in; and
 * not again on the opening that just answered "continue". Unclaimed — never
 * named, or forgotten since — asks every time the link is opened.
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

/** The few manifest members this app rewrites; everything else is carried over. */
interface WebManifest {
  id?: string;
  start_url?: string;
  scope?: string;
  icons?: { src: string }[];
}

/**
 * The app's manifest with its `start_url` moved to the invites, so an icon
 * added from `/install` lands on them instead of an empty app (docs/ios.md,
 * approach A).
 *
 * One invite starts at `/join`, which is the screen that says what is
 * happening — it names the group and waits out a first sync. Several start
 * back at `/install`, which is the only route that reads a fragment of them.
 *
 * Every URL comes out absolute. A runtime manifest can only be handed to the
 * page as a `blob:` URL, and relative members are resolved against the
 * manifest's own URL — which for a blob is opaque, so `/icon-192.png` doesn't
 * resolve at all. `id` is pinned to what the original resolved to (it defaults
 * to `start_url`), so this stays the same app rather than a second one per
 * invite.
 */
export function invitedManifest(
  base: WebManifest, invites: readonly JoinLink[], origin: string,
): WebManifest {
  return {
    ...base,
    id: new URL(base.id ?? base.start_url ?? "/", origin).href,
    start_url: invites.length === 1
      ? formatJoinLink(invites[0]!, origin)
      : `${origin}/install#${formatInvites(invites)}`,
    scope: new URL(base.scope ?? "/", origin).href,
    icons: base.icons?.map((icon) => ({ ...icon, src: new URL(icon.src, origin).href })),
  };
}

/**
 * Make this page the one that carries its invites onto the home screen, for as
 * long as it is on screen. Returns the undo.
 *
 * The page's own URL is half of it and costs nothing: `route.install(links)`
 * put the invites in the fragment, and a manifest iOS cannot read leaves it
 * bookmarking the URL it is looking at. This is the other half — the app's
 * manifest, refetched and handed back as a `blob:` with `start_url` on those
 * same invites, for a WebKit that reads the manifest link as it stands when
 * the share sheet opens.
 *
 * The href is **swapped, not removed**: Next owns that element and puts back
 * one taken out from under it (leaving two manifests, the static one winning).
 * Swapping loses nothing — a manifest that fails to fetch falls back to the
 * document URL, which is the fragment above — and it keeps the head to one
 * manifest, which is what the fallback needs.
 *
 * Which of the two WebKit actually uses is the open question in docs/ios.md.
 * With a single invite they land on different URLs — `/join#…` and
 * `/install#…` — and both open the same group, so the launched app is the
 * answer.
 */
export function offerInviteToHomeScreen(invites: readonly JoinLink[]): () => void {
  const element = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  const original = element?.getAttribute("href");
  if (!element || !original) return () => {};

  let url: string | undefined;
  let undone = false;
  void (async () => {
    try {
      const base = (await (await fetch(original)).json()) as WebManifest;
      if (undone) return;
      url = URL.createObjectURL(new Blob(
        [JSON.stringify(invitedManifest(base, invites, location.origin))],
        { type: "application/manifest+json" },
      ));
      element.setAttribute("href", url);
    } catch {
      // The page URL is the other half, and it is already carrying the invites.
    }
  })();

  return () => {
    undone = true;
    // Put the app's own manifest back before leaving: a `blob:` revoked out
    // from under another screen is a manifest that no longer loads at all.
    element.setAttribute("href", original);
    if (url) URL.revokeObjectURL(url);
  };
}
