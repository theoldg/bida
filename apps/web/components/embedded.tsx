"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Body, Screen, Scroll, TopBar } from "./chrome";
import { CopyLink } from "./copy-link";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { embeddedApp, looksEmbedded } from "../lib/embedded";
import { isStandalone, looksIos } from "../lib/install";

const never = () => () => {};

function embedded(): boolean {
  if (typeof window === "undefined") return false;
  return looksEmbedded({
    ua: navigator.userAgent,
    ios: looksIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
    standalone: isStandalone(),
  });
}

/**
 * The app, or the way out of the in-app browser it has been opened in — never
 * both (`lib/embedded.ts`).
 *
 * **Everything is behind this**, sync and the service worker included, not just
 * the screens: a webview is a storage nobody can get back to, so a group joined
 * in one is a key that dies with the app switcher and a claim the person makes
 * again the moment they open the same link properly. Joining twice from one
 * invite is the failure docs/ios.md is built around, and the in-app browser is
 * the commonest way into it — Messenger and Instagram turn theirs back on at
 * every update, so this is not a setting anyone can be asked to fix once.
 *
 * Refusing is the whole of the design. There is nothing to offer in here: no
 * Add to Home Screen in a webview, and no way for a page to send itself to a
 * real browser (no scheme, no universal link — Android's `intent://` is the
 * only one and it is Android's alone). So the screen names the app, says what
 * to press, and hands over the link.
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
 */
function Escape() {
  const { embedded: page } = copy;
  const app = embeddedApp(navigator.userAgent);
  return (
    <Screen>
      <Body>
        <TopBar title={<span className="brand">{copy.app.name}</span>} />
        <Scroll>
          <div className="pad keyless">
            <div className="keyless-badge"><Icon name="more" size={20} /></div>
            <h2>{page.title}</h2>
            <p>{page.why(app)}</p>
            <p>{page.how}</p>
            <div className="escapelink"><CopyLink link={window.location.href} /></div>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}
