"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { heldInvites } from "../lib/db/commands";
import { setInstallNudgeCollapsed } from "../lib/db/device";
import { route } from "../lib/group-link";
import { useDevice } from "../lib/hooks";
import { useLive } from "../lib/db/live";
import {
  headIsStale, installOffer, iosBrowser, keepCarried, promptInstall, reloadsForCarry, subscribeInstall,
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
 */
function KeepCarried() {
  const groups = useLive("carried", () => heldInvites(), []);
  const pathname = usePathname();
  useEffect(() => {
    if (!groups) return;
    keepCarried(groups);
    if (!headIsStale() || !reloadsForCarry(pathname)) return;
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
 * The nudge on the groups list — Chrome's own install prompt, offered the same
 * way `InstallBanner` warns on iOS: atop the list, once there is a group in it,
 * with an outlined button rather than an inked one. The two never draw
 * together, `offer` is one or the other.
 *
 * **It folds, it does not dismiss.** The offer stands until the phone installs,
 * at which point `offer` becomes "installed" and the card stops rendering by
 * itself — persisting storage is worth a standing ask. But having read it once
 * you should be able to put it away, so the title doubles as a disclosure and
 * the state is remembered per device.
 */
export function InstallNudge() {
  const offer = useInstallOffer();
  const device = useDevice();
  if (offer !== "ready") return null;
  // undefined is "Dexie hasn't answered yet", and drawing the card open before
  // it does would snap it shut a frame later on a phone that folded it.
  if (!device) return null;
  const open = !device.installNudgeCollapsed;

  return (
    <div className="pad" style={{ paddingBottom: 4 }}>
      <div className="card">
        <button type="button" className="nudgehead" aria-expanded={open}
          onClick={() => void setInstallNudgeCollapsed(open)}>
          {copy.install.title}
          <Icon name="chev" size={11} className={`kvchev${open ? " on" : ""}`} />
        </button>
        {open ? <Offer /> : null}
      </div>
    </div>
  );
}

function Offer() {
  return (
    <>
      <p className="hint" style={{ marginTop: 4 }}>{copy.install.body}</p>
      <button className="btn btn-s" style={{ marginTop: 11 }} onClick={() => void promptInstall()}>
        {copy.act.add}
      </button>
    </>
  );
}

/**
 * An iOS tab's card atop the groups list rather than at its foot: once the tab
 * holds a group, "this browser will clear it" is true and worth reading first.
 * Also atop each group's ledger, for whoever only ever arrives by a group's
 * link and never sees the list — `folded` there until the phone has chosen,
 * since the entries are what that screen is for.
 * The caller draws it only then — an empty home is someone looking around, and
 * Quick split stores nothing to lose. The how lives on `/install`.
 *
 * **It folds, like the nudge**, on the same device flag (an iOS tab never draws
 * the nudge, so the two can't disagree): someone who has chosen to stay in the
 * browser has read it, and a warning they can't put away is nagging.
 *
 * Every group the tab holds rides along to `/install`, and so onto the home
 * screen (docs/ios.md) — the tab is what forgets, so leaving any behind just
 * leaves a paste to do later. `groupId` is only which one goes first: the top
 * row of the list this card sits on, the most recently active and the one the
 * app would reopen by itself (lib/launch.ts).
 */
export function InstallBanner({ groupId, folded = false }: { groupId: string; folded?: boolean }) {
  const offer = useInstallOffer();
  const browser = useBrowserName();
  const device = useDevice();
  if (offer !== "manual" || !device) return null;
  const open = !(device.installNudgeCollapsed ?? folded);
  return (
    <div className="pad" style={{ paddingBottom: 4 }}>
      <div className="card">
        <button type="button" className="nudgehead" aria-expanded={open}
          onClick={() => void setInstallNudgeCollapsed(open)}>
          {copy.install.banner.title}
          <Icon name="chev" size={11} className={`kvchev${open ? " on" : ""}`} />
        </button>
        {open ? (
          <>
            <p className="hint" style={{ marginTop: 4, textWrap: "balance" }}>{copy.install.banner.body(browser)}</p>
            <InstallButton first={groupId} />
          </>
        ) : null}
      </div>
    </div>
  );
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
      {copy.install.banner.act}
    </button>
  );
}
