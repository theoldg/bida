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

import { note } from "./diag";
import { formatInvites, type CarriedGroup } from "./group-link";

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

/** Running as an installed app rather than in a browser page, on any platform. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
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
export interface WebManifest {
  id?: string;
  start_url?: string;
  scope?: string;
  icons?: { src: string }[];
}

/**
 * The manifest a home-screen icon is added with from an iOS tab: the app's
 * own, starting at `/install#<carry>` — every group the tab holds, and who it
 * is in each — so the icon's first launch brings them in (docs/ios.md).
 *
 * Every URL comes out absolute. It is handed to the page as a `blob:`, and
 * relative members resolve against the manifest's own URL, which for a blob is
 * opaque. `id` is pinned to what the original resolved to (it defaults to
 * `start_url`), so this stays one app whatever it carries.
 *
 * **Self-contained on purpose** — no imports, no helpers, no spread: its
 * source is pasted into `manifestScript`, which runs before any bundle does.
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
 * page's head — the HTML itself carries none.
 *
 * On a real iPhone Safari took the manifest the page *loaded* with: a link
 * swapped 41ms in was ignored and the icon opened at `/`. So in an iOS tab the
 * link has to be right before anything reads the head, on whatever page the
 * share sheet is opened from, and the groups have to come from something
 * synchronous — localStorage, kept by `keepCarried`. Everywhere else, and in
 * a tab holding no groups, it is the static manifest.
 *
 * `data-carry` records what the head was built with, so a page can tell when
 * it has gone stale (`headIsStale`). `looksIos` and `isStandalone` are
 * restated here for the same reason.
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
 * Keep the iOS tab's copy of what an icon would carry: every group held, and
 * who this phone is in each. localStorage is what the next page load builds
 * its manifest from. Only an iOS tab writes it: the secrets are already on this
 * origin in IndexedDB, but nowhere else needs a second copy.
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
 * Whether this page's manifest was built from a carry that has since changed —
 * a group joined, or a name picked, after it loaded. Safari won't read a
 * swapped link, so an icon added from this page would leave that change behind
 * (the owner's phone arrived with two groups and one name). Only a reload fixes
 * it; `reloadsForCarry` says when one is harmless.
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

/**
 * Screens a reload can't cost anything on: nothing typed, no flow half way
 * through. The join, claim and install screens are flows, and the forms warn
 * on unload — a stale head there waits for the next screen that is on this list.
 */
const RELOADABLE = new Set(["/", "/g", "/g/members", "/g/history", "/g/entry", "/about"]);

export function reloadsForCarry(pathname: string): boolean {
  return RELOADABLE.has(pathname.replace(/\/$/, "") || "/");
}
