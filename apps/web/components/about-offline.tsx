"use client";

import { Icon } from "./icons";
import { InstallButton, useInstallOffer } from "./install";
import { copy } from "../lib/copy";
import { promptInstall } from "../lib/install";

/**
 * The about screen's "Works offline" section, whole — not just the link
 * under it, because the claim itself reads differently once it's already
 * true: "add it" would sit right above a line saying it's already added.
 *
 * It is the one client thing on an otherwise static screen, and it renders
 * whichever of the four truths applies: the plain offer, a button where
 * Chrome gave us a prompt, the button into `/install` on iOS where no API
 * exists, and the sentence rewritten where the app is already on the home
 * screen. On a desktop browser that neither installs nor tells us, only the
 * plain offer shows.
 */
export function AboutOffline() {
  const offer = useInstallOffer();
  const { offline } = copy.about;

  return (
    <section className="aboutsect">
      <h4>{offline.title}</h4>
      <p>{offer === "installed" ? offline.bodyInstalled : offline.body}</p>
      {offer === "ready" ? (
        <div className="aboutlinks">
          <button className="aboutlink" onClick={() => void promptInstall()}>
            <Icon name="share" size={14} />{copy.install.title}
          </button>
        </div>
      ) : null}
      {offer === "manual" ? <InstallButton /> : null}
    </section>
  );
}
