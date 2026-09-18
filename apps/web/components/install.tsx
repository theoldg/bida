"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { heldInvites } from "../lib/db/commands";
import { setInstallNudgeCollapsed } from "../lib/db/device";
import { route } from "../lib/group-link";
import { useDevice } from "../lib/hooks";
import { useLive } from "../lib/db/live";
import { reloadCostsNothing, shellIsWarm } from "../lib/update";
import {
  headIsStale, installOffer, iosBrowser, keepCarried, promptInstall, subscribeInstall,
  type InstallOffer,
} from "../lib/install";

export function useInstallOffer(): InstallOffer {
  return useSyncExternalStore(subscribeInstall, installOffer, () => "none" as const);
}

/**
 * In an iOS tab, keeps what a home-screen icon added from *any* page would
 * bring: every group held, and who this phone is in each (`keepCarried`,
 * docs/ios.md). Mounted once, in the layout.
 */
export function CarryToHomeScreen() {
  return useInstallOffer() === "manual" ? <KeepCarried /> : null;
}

/**
 * Off to `/install` with every group in its fragment, `first` leading — after
 * writing what the tutorial's head will build its manifest from, since the
 * live copy may not have caught up with a key saved a moment ago. Written in
 * `KeepCarried`'s own order, or the two would take turns rewriting it.
 */
export async function carryThenInstall(first?: string): Promise<void> {
  keepCarried(await heldInvites());
  location.assign(route.install(await heldInvites(first)));
}

/**
 * And when what it would bring changed after this page loaded, reloads it on
 * the first screen where that is harmless — Safari only reads the manifest at
 * load, and the share sheet can be opened on any page (`headIsStale`).
 *
 * Wider than the update's own reload, which holds out for the groups list
 * (`mayReloadHere`, lib/update.ts): this one is an iOS tab's, where a reload
 * is a flash rather than a relaunch, and the visit it fires on is a
 * newcomer's first, which never passes the list at all.
 *
 * Harmless includes cheap. The reload's only job is to have the head right for
 * a share sheet nobody has opened yet, so nothing on screen is waiting on it —
 * and the visit it fires on most reliably is the newcomer's first, where their
 * document load was `/join` with an empty carry and everything since has been
 * the router. That is also the one minute the shell is being fetched over the
 * phone's connection, so the reload would go to the network and race the
 * precache for it. Deferring costs nothing: this effect runs again on every
 * pathname change, and the next reloadable screen does it once the shell is
 * warm. If the worker never lands at all, never reloading is the better
 * trade — a stale head costs a paste later, a blank first minute costs the app.
 */
function KeepCarried() {
  const groups = useLive("carried", () => heldInvites(), []);
  const pathname = usePathname();
  useEffect(() => {
    if (!groups) return;
    keepCarried(groups);
    if (!headIsStale() || !reloadCostsNothing(pathname) || !shellIsWarm()) return;
    const typing = document.activeElement?.matches("input, textarea, [contenteditable]");
    if (typing || document.visibilityState !== "visible") return;
    location.replace(location.href);
  }, [groups, pathname]);
  return null;
}

const never = () => () => {};

/** The iOS browser's name for copy, or undefined when it can't tell (and in the static export). */
export function useBrowserName(): string | undefined {
  return useSyncExternalStore(never, () => iosBrowser(navigator.userAgent), () => undefined);
}

/**
 * The card both offers are drawn in, so the two cannot drift apart in shape:
 * the title doubles as the disclosure, and the body is whatever the platform
 * is owed. **They fold, they do not dismiss** — the offer stands until the
 * phone installs, at which point `offer` stops being "ready" or "manual" and
 * the card stops rendering by itself. But having read it once you should be
 * able to put it away.
 */
function FoldedOffer(
  { title, open, onToggle, children }:
  { title: string; open: boolean; onToggle: () => void; children: ReactNode },
) {
  return (
    <div className="pad" style={{ paddingBottom: 4 }}>
      <div className="card">
        <button type="button" className="nudgehead" aria-expanded={open} onClick={onToggle}>
          {title}
          <Icon name="chev" size={11} className={`kvchev${open ? " on" : ""}`} />
        </button>
        {open ? children : null}
      </div>
    </div>
  );
}

/**
 * Chrome's own install prompt, one tap. **An offer, not a warning**: Android's
 * tab and its installed app are one origin and one IndexedDB, so installing
 * buys an icon, the browser bar gone and a reliable `persist()` — never a
 * group back. That is the whole difference between this card and the iOS
 * banner below, and it is in the words, not in where either one sits.
 */
function NudgeBody() {
  return (
    <>
      <p className="hint" style={{ marginTop: 4 }}>{copy.install.body}</p>
      {/* "Add" rather than the banner's "Add bida to home screen": this one
        opens the OS install sheet where it stands, and the banner's navigates
        to a tutorial. Two acts, two labels. */}
      <button className="btn btn-s" style={{ marginTop: 11 }} onClick={() => void promptInstall()}>
        {copy.act.add}
      </button>
    </>
  );
}

/**
 * The iOS tab's warning: this browser will clear the groups it is holding, and
 * the home screen is the only exemption (docs/ios.md). Every group the tab
 * holds rides along to `/install`, and so onto the home screen — the tab is
 * what forgets, so leaving any behind just leaves a paste to do later.
 * `groupId` is only which one goes first.
 */
function BannerBody({ groupId }: { groupId: string }) {
  const browser = useBrowserName();
  return (
    <>
      <p className="hint" style={{ marginTop: 4, textWrap: "balance" }}>{copy.install.banner.body(browser)}</p>
      <InstallButton first={groupId} />
    </>
  );
}

/**
 * The offer atop the groups list, whichever this browser is owed — Chrome's
 * prompt or the iOS tab's warning, never both (`offer` is one or the other).
 * Drawn only once the list holds a group: an empty home is someone looking
 * around, Quick split stores nothing to lose, and nobody installs an app
 * sight unseen.
 *
 * The fold is the device's and outlives the visit, because this is the screen
 * you can leave by scrolling past it. The ledger's copy of the same card takes
 * the opposite trade — see `LedgerInstall`.
 */
export function InstallOfferCard({ groupId }: { groupId: string }) {
  const offer = useInstallOffer();
  const device = useDevice();
  if (offer !== "ready" && offer !== "manual") return null;
  // undefined is "Dexie hasn't answered yet", and drawing the card open before
  // it does would snap it shut a frame later on a phone that folded it.
  if (!device) return null;
  const open = !device.installNudgeCollapsed;
  const toggle = () => void setInstallNudgeCollapsed(open);
  return offer === "manual"
    ? <FoldedOffer title={copy.install.banner.title} open={open} onToggle={toggle}>
        <BannerBody groupId={groupId} />
      </FoldedOffer>
    : <FoldedOffer title={copy.install.title} open={open} onToggle={toggle}>
        <NudgeBody />
      </FoldedOffer>;
}

/**
 * The same card atop a group's ledger, above your balance, for whoever only
 * ever arrives by a group's link and never lingers on the list — which is
 * nearly everyone: a launch reopens the group you were last in and a join
 * pushes it over the list, so `lib/launch.ts` is built to route around the one
 * screen the card above sits on. Both platforms, because both are reached the
 * same way; the iOS one says more because it has more to say.
 *
 * Folded on every visit and remembering nothing: the entries are what that
 * screen is for, so it offers itself as one line each time rather than taking
 * the list's fold. That line goes the moment the phone installs.
 */
export function LedgerInstall({ groupId }: { groupId: string }) {
  const offer = useInstallOffer();
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen(!open);
  if (offer === "manual") {
    return (
      <FoldedOffer title={copy.install.banner.title} open={open} onToggle={toggle}>
        <BannerBody groupId={groupId} />
      </FoldedOffer>
    );
  }
  if (offer === "ready") {
    return (
      <FoldedOffer title={copy.install.title} open={open} onToggle={toggle}>
        <NudgeBody />
      </FoldedOffer>
    );
  }
  return null;
}

/**
 * The banner's button on its own, for the about screen's "Works offline" in an
 * iOS tab: `/install` is where the how lives, so the one line that sat there
 * restating it gave way to the door. `first` is the group to lead the carry,
 * when there is one to prefer.
 *
 * `location.assign` rather than a `<Link>`: the fragment is the invites, and
 * the router drops it when it falls back to loading the page itself
 * (docs/ios.md#gotchas).
 */
export function InstallButton({ first }: { first?: string }) {
  return (
    <button type="button" className="btn btn-s" style={{ marginTop: 11 }}
      onClick={() => void carryThenInstall(first)}>
      {copy.install.act}
    </button>
  );
}
