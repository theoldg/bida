/**
 * Chrome fires `beforeinstallprompt` once, early, and only that event can open
 * the sheet later — so the listener goes on at module load, not in an effect.
 */

import { keepNote } from "./diag";
import { formatInvites, type CarriedGroup } from "./group-link";
import { signal } from "./signal";

export type InstallOffer =
  | "installed"
  /** A captured prompt: one tap installs it. */
  | "ready"
  /** No API — say where the button is (iOS). */
  | "manual"
  | "none";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Pure, so the awkward combinations are testable without a browser. */
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

/** Other iOS browsers mark themselves and web views drop `Safari/`, so only an unmarked one is Safari. */
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
    // Or Chrome shows its own mini-infobar beside our button.
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

/** Where a tapped join link opens in Safari, whose storage isn't the app's. */
export function iosHomeScreenApp(): boolean {
  if (typeof window === "undefined") return false;
  return isStandalone() && looksIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches
    // Safari's own flag, and the only signal iOS gives.
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** The event is spent either way; Chrome fires a fresh one if it offers again. */
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
 * Starts at `/install#<carry>`, so the icon's first launch brings every group
 * (docs/ios.md). Every URL absolute, since a `blob:` can't resolve relative
 * ones. **Self-contained** — no imports or spread: its source is pasted into
 * `manifestScript`.
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
 * An inline script at the top of every head: Safari takes the manifest the
 * page *loaded* with, and ignores a link swapped 41ms in. So it reads
 * localStorage, the one synchronous store. `looksIos` and `isStandalone` are
 * restated inside for the same reason `carriedManifest` is self-contained.
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

/** For the next load's manifest. Only an iOS tab needs this second copy. */
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
  keepNote("install.carry", `${groups.length} groups, ${groups.filter((g) => g.me).length} named`);
}

/** Safari won't read a swapped link, so only a reload fixes a stale one. */
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
