"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Body, Screen, Scroll, TopBar } from "./chrome";
import { CopyLink } from "./copy-link";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { embeddedApp, looksEmbedded } from "../lib/embedded";
import { isStandalone, looksIos } from "../lib/install";

const never = () => () => {};

const onIos = () =>
  looksIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);

function embedded(): boolean {
  if (typeof window === "undefined") return false;
  return looksEmbedded({ ua: navigator.userAgent, ios: onIos(), standalone: isStandalone() });
}

/**
 * The app, or the way out of the in-app browser it was opened in — never both
 * (`lib/embedded.ts`).
 *
 * **Everything is behind this**, sync and service worker included: a webview's
 * storage is unreachable later, so a group joined there is a key that dies
 * and a claim made twice (docs/ios.md).
 *
 * **Refusing is the whole design**: a webview has no Add to Home Screen and a
 * page can't send itself to a real browser (`intent://` is Android-only). So
 * the screen names the app, says what to press, and hands over the link.
 *
 * False on the server and through hydration, so the export stays one HTML
 * file and the first client render decides.
 */
export function EmbeddedGate({ children }: { children: ReactNode }) {
  return useSyncExternalStore(never, embedded, () => false) ? <Escape /> : <>{children}</>;
}

/**
 * Set like `BadLinkNotice` — the app can't do it, here's the fix. No back
 * arrow: there is nowhere back to.
 *
 * The badge is the menu glyph the line below says to tap, turned on its side
 * for iOS, so it always matches the sentence. Only the instruction is in ink;
 * the link below covers an app that moved or renamed the item.
 */
function Escape() {
  const { embedded: page } = copy;
  const ios = onIos();
  const app = embeddedApp(navigator.userAgent);
  return (
    <Screen>
      <Body>
        <TopBar title={<span className="brand">{copy.app.name}</span>} />
        <Scroll>
          <div className="pad keyless">
            <div className="keyless-badge">
              <Icon name="more" size={20} className={ios ? "lying" : undefined} />
            </div>
            <h2>{page.title}</h2>
            <p>{page.why(app)}</p>
            <p className="escapehow">{ios ? page.how.ios : page.how.android}</p>
            <div className="escapelink"><CopyLink link={window.location.href} /></div>
            <p className="escapepaste">{page.orPaste}</p>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}
