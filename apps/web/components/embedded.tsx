"use client";
// Doc: docs/ios.md#the-in-app-browser--a-one-off-visit

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { heldInvites } from "../lib/db/commands";
import { useLive } from "../lib/db/live";
import { formatInvites, route } from "../lib/group-link";
import { embeddedApp, intentLink, looksEmbedded } from "../lib/embedded";
import { isStandalone, looksIos } from "../lib/install";

const never = () => () => {};

const onIos = () =>
  looksIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);

export function embedded(): boolean {
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
 * the system hands to the default browser, when the host lets it; on iOS no
 * page can open Safari. Both name the host's button that does, and hand over
 * the link to copy by hand.
 * The demo, the install and notification offers stand down while this shows
 * (`DemoCard`, `offerFrom`).
 *
 * **Not on a quick split's link** (`/split`): it holds nothing on the phone,
 * so there is nothing to lose here, and its address is already the whole
 * way out — any *Open in browser* opens the split as it stands.
 */
export function EmbeddedBanner() {
  const [open, setOpen] = useState(unfolded);
  if (!useEmbedded() || NOTHING_HELD.test(location.pathname)) return null;
  const toggle = () => { unfolded = !unfolded; setOpen(unfolded); };
  return (
    <div className="banner webview">
      <KeepInAddress />
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
 * A group's screens carry that group alone, so the host's own *Copy link*
 * gives away no other; the rest carry every group this webview holds.
 */
function useCarry() {
  const id = new URLSearchParams(location.search).get("id") ?? undefined;
  return useLive("wayOut", async () => (await heldInvites(id)).filter((g) => !id || g.groupId === id), [id]);
}

/**
 * iOS's way out is the host app's *Open in browser*, which opens the address
 * as it stands — past the join, a group's id and nothing more. So the address
 * keeps the carry in its fragment, which never reaches a server, and the page
 * Safari opens hands it to `/handover` before it paints (`handoverFrom`). Not
 * on the screens whose fragment is their own.
 */
function KeepInAddress() {
  const groups = useCarry();
  useEffect(() => {
    if (!groups?.length || OWN_FRAGMENT.test(location.pathname)) return;
    const hash = `#${formatInvites(groups)}`;
    if (location.hash !== hash) {
      history.replaceState(history.state, "", location.pathname + location.search + hash);
    }
  });
  return null;
}

const OWN_FRAGMENT = /^\/(join|install|handover|split)(\.html)?$/;

const NOTHING_HELD = /^\/split(\.html)?$/;

/**
 * The carry (`useCarry`), and who this webview is in each group, as an icon
 * launch carries them (`route.handover`): the address holds only the id past
 * the join, so it would land on "missing its password". No link until the
 * keys are read, for the same reason.
 *
 * Android's button is a request the host may drop — Reddit's webview does
 * nothing with an `intent:` — so the host's own menu and the link follow it
 * there too, the address keeping the same carry (`KeepInAddress`).
 *
 * The link is text, not a copy button: Messenger's webview has no clipboard
 * (`lib/clipboard.ts`), so it is selected whole by a hold.
 */
function WayOut() {
  const groups = useCarry();
  const ios = onIos();
  const href = !groups ? undefined
    : groups.length ? `${location.origin}${route.handover(groups)}` : location.href;
  return (
    <div className="webviewbody">
      <p>{copy.embedded.detail}</p>
      {!ios && href ? <a className="btn btn-s" href={intentLink(href)}>{copy.embedded.open}</a> : null}
      <p className="webviewhow">{withMenu(ios ? copy.embedded.how : copy.embedded.howElse, ios)}</p>
      {href ? <>
        <p className="webviewhow webviewor">{copy.embedded.orCopy}</p>
        <div className="linkbox webviewlink"><span className="selectable">{href}</span></div>
      </> : null}
    </div>
  );
}

/**
 * The copy's `⋯` drawn as the button it names, so the eye finds it in the
 * host's bar: across on iOS, upright as Android's hosts draw it.
 */
function withMenu(line: string, across: boolean): ReactNode {
  const [before, ...after] = line.split("⋯");
  return after.length
    ? <>{before}<span className="menuchip" role="img" aria-label="⋯"><Icon name="more" size={14} style={across ? { transform: "rotate(90deg)" } : undefined} /></span>{after.join("⋯")}</>
    : line;
}
