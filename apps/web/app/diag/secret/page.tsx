"use client";
// Doc: docs/diag.md

import Link from "next/link";
import { useEffect, useState } from "react";
import { Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { Icon } from "@/components/icons";
import { copy, lang } from "@/lib/copy";
import { route } from "@/lib/group-link";
import { setLang, type Lang } from "@/lib/lang";
import { setStasMode, stasMode } from "@/lib/scan/stas";

/**
 * The app's hidden settings, off `/diag` and back up to it, in Advanced's
 * dress. Finding them costs a long-press and a link nobody reads past.
 */
export default function SecretPage() {
  const { secret } = copy.diag;
  // After mount: the static export's first render has no localStorage.
  const [stas, setStas] = useState(false);
  useEffect(() => { setStas(stasMode()); }, []);

  return (
    <Screen>
      <Body>
        <TopBar title={secret.title} back={route.diag()} />
        <Scroll>
          <div className="pad about settings">
            <section className="aboutsect">
              <h3>{secret.stas}</h3>
              <div className="seg" role="group" aria-label={secret.stas}>
                {[false, true].map((on) => (
                  <button key={String(on)} type="button" className={on === stas ? "on" : ""}
                    aria-pressed={on === stas}
                    onClick={() => { if (on !== stas) { setStasMode(on); setStas(on); } }}>
                    {on ? secret.on : secret.off}
                  </button>
                ))}
              </div>
              <p className="keynote">{secret.stasNote}</p>
            </section>
            {/* Polish while it is being translated: "???" is a line not done yet.
                Each language named in itself, so it reads in either. A reload,
                since `copy` is picked once as the app loads. */}
            <section className="aboutsect">
              <h3>{secret.lang}</h3>
              <div className="seg" role="group" aria-label={secret.lang}>
                {(["en", "pl"] as const satisfies readonly Lang[]).map((l) => (
                  <button key={l} type="button" className={l === lang ? "on" : ""}
                    aria-pressed={l === lang}
                    onClick={() => { if (l !== lang) { setLang(l); location.reload(); } }}>
                    {copy.languages[l]}
                  </button>
                ))}
              </div>
            </section>
            <Link href={route.diagCrop()} className="setlink">
              {copy.diag.crop.title}
              <Icon name="chev" size={15} />
            </Link>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}
