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
export async function carryThenInstall(first: string): Promise<void> {
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
export function InstallBanner({ groupId }: { groupId: string }) {
  const offer = useInstallOffer();
  const browser = useBrowserName();
  const device = useDevice();
  if (offer !== "manual" || !device) return null;
  const open = !device.installNudgeCollapsed;
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
            {/* `location.assign` rather than a `<Link>`: the fragment is the
                invites, and the router drops it when it falls back to loading
                the page itself (docs/ios.md#gotchas). */}
            <button type="button" className="btn btn-s" style={{ marginTop: 11 }}
              onClick={() => void carryThenInstall(groupId)}>
              {copy.install.banner.act}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The iOS path in one line, for the about screen's "Works offline" — `/install`
 * is the full version. iOS gives no install API at all, so the honest
 * thing is to point at the button that does it rather than draw one that
 * can't, and to say what skipping it costs.
 *
 * It rides with the manual branch and nowhere else, because the seven days are
 * WebKit's. Chrome fires `beforeinstallprompt` and evicts on quota pressure,
 * not on a timer, so the same sentence under the "ready" button would be false.
 */
export function ManualSteps() {
  const browser = useBrowserName();
  return (
    <>
      <p className="hint" style={{ marginTop: 9 }}>
        {/* Tailwind's reset makes every svg a block; inline is what puts it
            in the middle of the sentence rather than on a line of its own. */}
        {copy.install.manual.tap} <Icon name="share" size={15}
          style={{ display: "inline", verticalAlign: "-2px", color: "var(--ink-2)" }} />,{" "}
        {copy.install.manual.then} <b style={{ fontWeight: 600 }}>{copy.install.manual.label}</b>.
      </p>
      {/* The one colour this design spends on trouble (globals.css `.failure`). */}
      <p className="failure">{copy.install.manual.warn(browser)}</p>
    </>
  );
}
