"use client";

import { Icon } from "./icons";
import { useInstallOffer } from "./install";
import { copy } from "../lib/copy";
import { promptInstall } from "../lib/install";

/**
 * The link under "Works offline" on the about screen, because that claim is
 * only true once the app is installed — saying so and then leaving the reader
 * to find the nudge at the foot of the groups list would be an instruction, not
 * an offer.
 *
 * It is the one client thing on an otherwise static screen, and it renders
 * whichever of the three truths applies: a button where Chrome gave us a
 * prompt, the share-sheet sentence on iOS where no API exists, and a quiet line
 * where the app is already on the home screen. On a desktop browser that
 * neither installs nor tells us, it draws nothing.
 */
export function AboutInstall() {
  const offer = useInstallOffer();

  if (offer === "installed") {
    return <p className="hint" style={{ marginTop: 11 }}>{copy.about.offline.installed}</p>;
  }
  if (offer === "ready") {
    return (
      <div className="aboutlinks">
        <button className="aboutlink" onClick={() => void promptInstall()}>
          <Icon name="share" size={14} />{copy.install.title}
        </button>
      </div>
    );
  }
  if (offer === "manual") {
    return (
      // Same sentence as the nudge on the groups list: iOS gives no install
      // API, so the honest thing is to point at the button that does it.
      <p className="hint" style={{ marginTop: 11 }}>
        {copy.install.manual.tap} <Icon name="share" size={15}
          style={{ display: "inline", verticalAlign: "-2px", color: "var(--ink-2)" }} />{" "}
        {copy.install.manual.then} <b style={{ fontWeight: 600 }}>{copy.install.manual.label}</b>.
      </p>
    );
  }
  return null;
}
