/**
 * "Add it to your home screen" — the browser state behind the install nudge.
 *
 * Chrome fires `beforeinstallprompt` once, early, and only that event can open
 * the sheet later — so the listener goes on at module load, not in an effect.
 * Safari fires nothing: on iOS the share sheet is the only path, hence the
 * "manual" offer.
 */

import { note } from "./diag";
import { formatInvites, type CarriedGroup } from "./group-link";
import { signal } from "./signal";

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

let captured: InstallPromptEvent | undefined;
let installed = false;
const { emit: announce, subscribe } = signal();

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

export const subscribeInstall = subscribe;

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
 * Running from the home screen on iOS, where a tapped join link opens in
 * Safari — whose storage isn't the app's — so the groups list offers to paste
 * one instead. Android opens in-scope links in the installed app.
 */
export function iosHomeScreenApp(): boolean {
  if (typeof window === "undefined") return false;
  return isStandalone() && looksIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
}

/** Running as an installed app rather than in a browser page, on any platform. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches
    // Safari's own flag, and the only signal iOS gives.
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Open the browser's install sheet; resolves once answered. The event is spent
 * either way (one prompt per event); Chrome fires a fresh one if it offers again.
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
export interface WebManifest {
  id?: string;
  start_url?: string;
  scope?: string;
  icons?: { src: string }[];
}

/**
 * The manifest an iOS tab's home-screen icon is added with: the app's own,
 * starting at `/install#<carry>`, so the icon's first launch brings every group
 * (docs/ios.md).
 *
 * Every URL absolute: it is handed over as a `blob:`, against which relative
 * members can't resolve. `id` is pinned to the original's, so it stays one app.
 *
 * **Self-contained on purpose** — no imports, helpers or spread: its source is
 * pasted into `manifestScript`, which runs before any bundle.
 */
export function carriedManifest(base: WebManifest, carry: string, origin: string): WebManifest {
  return Object.assign({}, base, {
    id: new URL(base.id || base.start_url || "/", origin).href,
    start_url: origin + "/install#" + carry,
    scope: new URL(base.scope || "/", origin).href,
    icons: (base.icons || []).map((icon) => Object.assign({}, icon, { src: new URL(icon.src, origin).href })),
  });
}

const STATIC_MANIFEST = "/manifest.webmanifest";
/** The tab's copy of `formatInvites(heldInvites())`, readable before IndexedDB is. */
const CARRY = "bida.carry";

/**
 * The app's manifest link, written by an inline script at the top of every
 * page's head — the HTML carries none.
 *
 * **Safari takes the manifest the page *loaded* with** — a link swapped 41ms in
 * is ignored. So in an iOS tab it is written before anything reads the head,
 * from something synchronous: localStorage, kept by `keepCarried`. Elsewhere,
 * or with no groups, it is the static manifest.
 *
 * `data-carry` records what it was built with (`headIsStale`). `looksIos` and
 * `isStandalone` are restated here for the same reason as above.
 */
export function manifestScript(base: WebManifest): string {
  return `(function(){var l=document.createElement("link");l.rel="manifest";l.href="${STATIC_MANIFEST}";`
    + `try{var n=navigator,ios=/iPad|iPhone|iPod/.test(n.userAgent)||(n.platform==="MacIntel"&&n.maxTouchPoints>1),`
    + `app=n.standalone===true||matchMedia("(display-mode: standalone)").matches,`
    + `c=ios&&!app&&localStorage.getItem("${CARRY}");`
    + `if(ios&&!app)l.setAttribute("data-carry",c||"");`
    + `if(c)l.href=URL.createObjectURL(new Blob([JSON.stringify((${carriedManifest.toString()})(${JSON.stringify(base)},c,location.origin))],{type:"application/manifest+json"}))`
    + `}catch(e){}document.head.appendChild(l)})()`;
}

/**
 * Keep the iOS tab's copy of what an icon would carry, in localStorage for the
 * next load's manifest. Only an iOS tab needs this second copy.
 */
export function keepCarried(groups: readonly CarriedGroup[]): void {
  if (installOffer() !== "manual") return;
  const carry = formatInvites(groups);
  try {
    if ((localStorage.getItem(CARRY) ?? "") === carry) return;
    if (carry) localStorage.setItem(CARRY, carry);
    else localStorage.removeItem(CARRY);
  } catch {
    return;
  }
  note("install.carry", `${groups.length} groups, ${groups.filter((g) => g.me).length} named`);
}

/**
 * Whether this page's manifest was built from a carry that has since changed.
 * Safari won't read a swapped link, so only a reload fixes it;
 * `reloadCostsNothing` (lib/update.ts) says where that is harmless.
 */
export function headIsStale(): boolean {
  const link = document.head.querySelector('link[rel="manifest"]');
  const built = link?.getAttribute("data-carry");
  if (built == null) return false;
  try {
    return (localStorage.getItem(CARRY) ?? "") !== built;
  } catch {
    return false;
  }
}
