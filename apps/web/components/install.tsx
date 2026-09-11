"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { installOffer, promptInstall, subscribeInstall, type InstallOffer } from "../lib/install";

export function useInstallOffer(): InstallOffer {
  return useSyncExternalStore(subscribeInstall, installOffer, () => "none" as const);
}

/**
 * The nudge on the groups list. It sits quietly at the foot of the list — the
 * app is only worth a home-screen slot once there is something in it, and a
 * bar across the top of the first screen would be the app talking about itself
 * before it has told you a single number.
 *
 * It has no dismiss: the offer stands until the phone installs, at which point
 * `offer` becomes "installed" and the nudge stops rendering by itself.
 */
export function InstallNudge() {
  const offer = useInstallOffer();
  if (offer !== "ready" && offer !== "manual") return null;

  return (
    <div className="pad" style={{ paddingTop: 18 }}>
      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 600 }}>{copy.install.title}</div>
        <Offer offer={offer} />
      </div>
    </div>
  );
}

function Offer({ offer }: { offer: "ready" | "manual" }) {
  return (
    <>
      <p className="hint" style={{ marginTop: 4 }}>{copy.install.body}</p>
      {offer === "ready" ? (
        <button className="btn btn-p" style={{ marginTop: 11 }} onClick={() => void promptInstall()}>
          {copy.act.add}
        </button>
      ) : (
        // iOS gives no install API at all, so the honest thing is to point at
        // the button that does it rather than draw one that can't.
        <p className="hint" style={{ marginTop: 9 }}>
          {/* Tailwind's reset makes every svg a block; inline is what puts it
              in the middle of the sentence rather than on a line of its own. */}
          {copy.install.manual.tap} <Icon name="share" size={15}
            style={{ display: "inline", verticalAlign: "-2px", color: "var(--ink-2)" }} />{" "}
          {copy.install.manual.then} <b style={{ fontWeight: 600 }}>{copy.install.manual.label}</b>.
        </p>
      )}
    </>
  );
}
