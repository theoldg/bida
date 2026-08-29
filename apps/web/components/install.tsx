"use client";

import { useSyncExternalStore } from "react";
import { Eyebrow } from "./bits";
import { Icon } from "./icons";
import { updateDevice } from "../lib/db/device";
import { useDevice } from "../lib/hooks";
import { installOffer, promptInstall, subscribeInstall, type InstallOffer } from "../lib/install";

export function useInstallOffer(): InstallOffer {
  return useSyncExternalStore(subscribeInstall, installOffer, () => "none" as const);
}

/**
 * The nudge on the groups list. It asks once, quietly, at the foot of the
 * list — the app is only worth a home-screen slot once there is something in
 * it, and a bar across the top of the first screen would be the app talking
 * about itself before it has told you a single number.
 *
 * "Not now" is remembered on the phone rather than for the session: asking
 * again next launch is what makes install banners hated. Settings keeps the
 * offer for anyone who changes their mind.
 */
export function InstallNudge() {
  const offer = useInstallOffer();
  const device = useDevice();
  if (device?.installDismissedAt) return null;
  if (offer !== "ready" && offer !== "manual") return null;

  return (
    <div className="pad" style={{ paddingTop: 18 }}>
      <div className="card">
        <Offer offer={offer} heading />
        <button className="action" style={{ marginTop: 12, color: "var(--muted)" }}
          onClick={() => updateDevice({ installDismissedAt: Date.now() })}>
          Not now
        </button>
      </div>
    </div>
  );
}

/** The same offer in Settings, where it stays available after "Not now". */
export function InstallSettings() {
  const offer = useInstallOffer();
  if (offer === "none") return null;

  return (
    <section>
      <Eyebrow style={{ marginBottom: 9 }}>Home screen</Eyebrow>
      {offer === "installed" ? (
        <p className="hint" style={{ marginTop: 0 }}>
          Hajsik is installed on this phone.
        </p>
      ) : (
        <Offer offer={offer} />
      )}
    </section>
  );
}

/** The heading is the nudge's own title; in Settings the eyebrow already says it. */
function Offer({ offer, heading }: { offer: "ready" | "manual"; heading?: boolean }) {
  return (
    <>
      {heading ? (
        <div style={{ fontSize: 14, fontWeight: 600 }}>Keep Hajsik on your home screen</div>
      ) : null}
      <p className="hint" style={{ marginTop: heading ? 4 : 0 }}>
        Its own icon, no browser bar, and the same data — it already works offline.
      </p>
      {offer === "ready" ? (
        <button className="btn btn-p" style={{ marginTop: 11 }} onClick={() => void promptInstall()}>
          Add to home screen
        </button>
      ) : (
        // iOS gives no install API at all, so the honest thing is to point at
        // the button that does it rather than draw one that can't.
        <p className="hint" style={{ marginTop: 9 }}>
          {/* Tailwind's reset makes every svg a block; inline is what puts it
              in the middle of the sentence rather than on a line of its own. */}
          Tap <Icon name="share" size={15}
            style={{ display: "inline", verticalAlign: "-2px", color: "var(--ink-2)" }} /> in the browser bar,
          then <b style={{ fontWeight: 600 }}>Add to Home Screen</b>.
        </p>
      )}
    </>
  );
}
