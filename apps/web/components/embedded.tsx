"use client";
// Doc: docs/ios.md#the-in-app-browser--a-one-off-visit

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { formatJoinLink } from "../lib/group-link";
import { useGroupSecret } from "../lib/hooks";
import { embeddedApp, intentLink, looksEmbedded } from "../lib/embedded";
import { isStandalone, looksIos } from "../lib/install";

const never = () => () => {};

const onIos = () =>
  looksIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);

function embedded(): boolean {
  if (typeof window === "undefined") return false;
  return looksEmbedded({ ua: navigator.userAgent, ios: onIos(), standalone: isStandalone() });
}

/**
 * In an in-app browser (`lib/embedded.ts`)? False on the server and through
 * hydration, so the export stays one HTML file and the first client render
 * decides.
 */
export function useEmbedded(): boolean {
  return useSyncExternalStore(never, embedded, () => false);
}

/**
 * Its children only outside an in-app browser: the service worker, which
 * would precache the whole app into a storage nothing comes back to.
 */
export function NotEmbedded({ children }: { children: ReactNode }) {
  return useEmbedded() ? null : <>{children}</>;
}

/** Across screens, so moving on doesn't fold it back. */
let unfolded = false;

/**
 * Atop every screen in an in-app browser (`Screen`): the app runs, its edits
 * sync, but nothing outside this webview can see the groups it holds — so it
 * says so, and folds open on the way out.
 *
 * **The way out differs by platform.** Android takes an `intent:` link, which
 * the system hands to the default browser; on iOS no page can open Safari, so
 * the line names the button that does. The demo, the install and notification
 * offers stand down while this shows (`DemoCard`, `offerFrom`).
 */
export function EmbeddedBanner() {
  const [open, setOpen] = useState(unfolded);
  if (!useEmbedded()) return null;
  const toggle = () => { unfolded = !open; setOpen(!open); };
  return (
    <div className="banner webview">
      <button type="button" className="webviewhead" aria-expanded={open} onClick={toggle}>
        <Icon name="info" size={15} style={{ flex: "none" }} />
        <span>{copy.embedded.title(embeddedApp(navigator.userAgent))}</span>
        <Icon name="chev" size={11} className={`kvchev${open ? " on" : ""}`} />
      </button>
      {open ? <WayOut /> : null}
    </div>
  );
}

/**
 * On a group's screen, that group's invite rather than the address: past the
 * join, the address holds only the id, and the browser it opens in has no key.
 */
function WayOut() {
  const id = new URLSearchParams(location.search).get("id") ?? undefined;
  const secret = useGroupSecret(id);
  const href = id && secret ? formatJoinLink({ groupId: id, secret }) : location.href;
  return (
    <div className="webviewbody">
      <p>{copy.embedded.detail}</p>
      {onIos()
        ? <p className="webviewhow">{copy.embedded.how}</p>
        : <a className="btn btn-s" href={intentLink(href)}>{copy.embedded.open}</a>}
    </div>
  );
}
