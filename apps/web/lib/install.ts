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

import { hideSecrets, note } from "./diag";
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
 * `/install`'s HTML carries no manifest (app/install/layout.tsx), so this
 * normally *adds* the link rather than swapping one: Safari read the static
 * manifest at load on a real iPhone, before any effect could change it. A
 * Safari that asks at load now finds nothing and bookmarks the page URL, which
 * is the fragment above. The link isn't Next's here, so removing it is safe.
 *
 * Which of the two WebKit actually uses is the open question in docs/ios.md.
 * With a single invite they land on different URLs — `/join#…` and
 * `/install#…` — and both open the same group, so the launched app is the
 * answer.
 */
export function offerInviteToHomeScreen(invites: readonly JoinLink[]): () => void {
  // Normally absent: `/install` leaves the manifest out for exactly this page
  // (`lateManifestScript`). One already there was put in before this effect
  // ran, and Safari may already have read it.
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  const created = !element;
  if (!element) {
    element = document.createElement("link");
    element.rel = "manifest";
  }
  const original = element.getAttribute("href") ?? STATIC_MANIFEST;
  const link = element;

  let url: string | undefined;
  let undone = false;
  void (async () => {
    try {
      const base = (await (await fetch(original)).json()) as WebManifest;
      if (undone) return;
      const manifest = invitedManifest(base, invites, location.origin);
      url = URL.createObjectURL(new Blob(
        [JSON.stringify(manifest)],
        { type: "application/manifest+json" },
      ));
      link.setAttribute("href", url);
      if (created) document.head.append(link);
      note("install.manifest", `${created ? "added" : "swapped (static one was in the head)"} at ${Math.round(performance.now())}ms, start_url ${hideSecrets(manifest.start_url ?? "")}`);
    } catch (error) {
      note("install.manifest", `swap failed: ${String(error)}`);
      // The page URL is the other half, and it is already carrying the invites.
    }
  })();

  return () => {
    undone = true;
    // Put the app's own manifest back before leaving: a `blob:` revoked out
    // from under another screen is a manifest that no longer loads at all.
    if (created) link.remove();
    else link.setAttribute("href", original);
    if (url) URL.revokeObjectURL(url);
  };
}

const STATIC_MANIFEST = "/manifest.webmanifest";

/**
 * Runs inline on `/install`, whose HTML carries no manifest: puts the app's
 * static one back everywhere but the page an iOS tab bookmarks invites from,
 * which gets its own from `offerInviteToHomeScreen` instead. Inline, and
 * `looksIos`/`isStandalone` restated, because the whole point is to beat
 * anything that reads the head at load.
 */
export const lateManifestScript = `(function(){var n=navigator,ios=/iPad|iPhone|iPod/.test(n.userAgent)||(n.platform==="MacIntel"&&n.maxTouchPoints>1),app=n.standalone===true||matchMedia("(display-mode: standalone)").matches;if(ios&&!app&&/\\./.test(location.hash))return;var l=document.createElement("link");l.rel="manifest";l.href="${STATIC_MANIFEST}";document.head.appendChild(l)})()`;
