"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { setInstallNudgeCollapsed } from "../lib/db/device";
import { route } from "../lib/group-link";
import { useDevice } from "../lib/hooks";
import { installOffer, iosBrowser, promptInstall, subscribeInstall, type InstallOffer } from "../lib/install";

export function useInstallOffer(): InstallOffer {
  return useSyncExternalStore(subscribeInstall, installOffer, () => "none" as const);
}

const never = () => () => {};

/** The iOS browser's name for copy, or undefined when it can't tell (and in the static export). */
export function useBrowserName(): string | undefined {
  return useSyncExternalStore(never, () => iosBrowser(navigator.userAgent), () => undefined);
}

/**
 * The nudge on the groups list. It sits quietly at the foot of the list — the
 * app is only worth a home-screen slot once there is something in it, and a
 * bar across the top of the first screen would be the app talking about itself
 * before it has told you a single number.
 *
 * **It folds, it does not dismiss.** The offer stands until the phone installs,
 * at which point `offer` becomes "installed" and the card stops rendering by
 * itself — persisting storage is worth a standing ask. (An iOS tab never gets
 * this card: there is no prompt to capture, and `InstallBanner` warns instead.) But
 * having read it once you should be able to put it away, so the title doubles
 * as a disclosure and the state is remembered per device.
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
    <div className="pad" style={{ paddingTop: 18 }}>
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
      <button className="btn btn-p" style={{ marginTop: 11 }} onClick={() => void promptInstall()}>
        {copy.act.add}
      </button>
    </>
  );
}

/**
 * An iOS tab's warning, atop the groups list rather than at its foot: once the
 * tab holds a group, "this browser will forget it" is true and is the first
 * thing worth reading. The caller draws it only then — an empty home is
 * someone looking around, and Quick split stores nothing to lose. It doesn't
 * fold: it stands until the phone installs, and the tab is then a tab nobody
 * opens. The how lives on `/install`, which the join choice shares.
 */
export function InstallBanner() {
  const offer = useInstallOffer();
  const browser = useBrowserName();
  if (offer !== "manual") return null;
  return (
    <div className="pad" style={{ paddingBottom: 4 }}>
      <Link href={route.install()} className="card installbanner">
        <span>
          <b>{copy.install.banner.title(browser)}</b>
          <span className="hint">{copy.install.banner.body}</span>
        </span>
        <Icon name="chev" size={11} />
      </Link>
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
