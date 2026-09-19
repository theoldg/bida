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
 * The app, or the way out of the in-app browser it has been opened in — never
 * both (`lib/embedded.ts`).
 *
 * **Everything is behind this**, sync and the service worker included, not just
 * the screens: a webview is a storage nobody can get back to, so a group joined
 * in one is a key that dies with the app switcher and a claim made again the
 * moment the link is opened properly. Joining twice from one invite is the
 * failure docs/ios.md is built around.
 *
 * **Refusing is the whole design** — there is nothing to offer in here: no Add
 * to Home Screen in a webview, and no way for a page to send itself to a real
 * browser (Android's `intent://` is the only scheme, and Android's alone). So
 * the screen names the app, says what to press, and hands over the link.
 *
 * Nothing renders it on the server and it is false through hydration, so the
 * export stays one HTML file and the first client render decides.
 */
export function EmbeddedGate({ children }: { children: ReactNode }) {
  return useSyncExternalStore(never, embedded, () => false) ? <Escape /> : <>{children}</>;
}

/**
 * Set like `BadLinkNotice` — badge, heading, prose — because it is the same
 * kind of screen: the app cannot do the thing, and this is the fix. The bar
 * carries the name and no arrow: there is nowhere back to.
 *
 * The badge is the menu the line below it says to tap, turned on its side for
 * iOS: one symbol, and it always matches the glyph in the sentence rather than
 * sending someone after a button shaped the other way. The instruction is the
 * one line here set in ink — the rest is why, and the link under it is what
 * to do when an app has moved the item or renamed it.
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
