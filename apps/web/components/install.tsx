"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useSyncExternalStore } from "react";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { getDevice, setInstallNudgeCollapsed } from "../lib/db/device";
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
 * **It folds, it does not dismiss.** The offer stands until the phone installs,
 * at which point `offer` becomes "installed" and the card stops rendering by
 * itself — persisting storage is worth a standing ask, and on iOS the card is
 * carrying a warning as well as a pitch (`copy.install.manual.warn`). But
 * having read it once you should be able to put it away, so the title doubles
 * as a disclosure and the state is remembered per device.
 */
export function InstallNudge() {
  const offer = useInstallOffer();
  const device = useLiveQuery(() => getDevice(), []);
  if (offer !== "ready" && offer !== "manual") return null;
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
        {open ? <Offer offer={offer} /> : null}
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
      ) : <ManualSteps />}
    </>
  );
}

/**
 * The iOS path, in both places that offer it — the nudge here and the about
 * screen's "Works offline". iOS gives no install API at all, so the honest
 * thing is to point at the button that does it rather than draw one that
 * can't, and to say what skipping it costs: the warning is the only reason
 * the card is worth a standing place on the list.
 *
 * It rides with the manual branch and nowhere else, because the seven days are
 * WebKit's. Chrome fires `beforeinstallprompt` and evicts on quota pressure,
 * not on a timer, so the same sentence under the "ready" button would be false.
 */
export function ManualSteps() {
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
      <p className="failure">{copy.install.manual.warn}</p>
    </>
  );
}
